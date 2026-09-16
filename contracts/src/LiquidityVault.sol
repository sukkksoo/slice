// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LiquidityAmounts} from "v4-periphery/libraries/LiquidityAmounts.sol";

import {ArcChain} from "./libraries/ArcChain.sol";
import {FullRange} from "./libraries/FullRange.sol";
import {PoolOracle} from "./libraries/PoolOracle.sol";
import {Settler} from "./libraries/Settler.sol";

/// @title LiquidityVault
/// @notice A fungible claim on one full-range Uniswap v4 position, with swap fees paid to stakers
///         as a streamed USDC yield and/or compounded back into the position.
///
/// @dev Shares, not position NFTs. On Arc every token launches into a v4 pool paired with USDC,
///      and v4 positions are non-fungible. Escrowing individual NFTs would make reward maths
///      depend on each depositor's chosen range; one vault-owned full-range position keeps shares
///      fungible, composable, and cheap to account for.
///
/// @dev Fees are streamed, not booked instantly. A harvest is a discrete jump in claimable value.
///      Landing it in NAV immediately would let anyone deposit in the block before a harvest and
///      withdraw in the block after, capturing fees they never provided liquidity for. Streaming
///      linearly over STREAM_DURATION makes that attack cost a full stream period of exposure,
///      which is exactly the position honest LPs hold.
///
/// @dev Every liquidity-changing action harvests first. `modifyLiquidity` sweeps the position's
///      *entire* accrued fee balance regardless of the liquidity delta, so a deposit or withdraw
///      that skipped the harvest would net those fees against the caller's own settlement and
///      quietly hand them another staker's yield.
///
/// @dev Arc note: ERC-20 currencies only; native-currency pools are rejected. Arc's native gas
///      asset is USDC at 18 decimals while the canonical ERC-20 interface at ArcChain.USDC_ERC20
///      exposes the same balance at 6 decimals. Supporting both inside one vault would put a 1e12
///      scale factor on every accounting path for no benefit, since Arc's v4 pools quote against
///      the ERC-20 representation.
contract LiquidityVault is ERC20, IUnlockCallback, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using SafeERC20 for IERC20;
    using PoolOracle for PoolOracle.Oracle;

    // --- constants ---

    /// @notice Duration over which each harvest is paid out to stakers.
    uint256 public constant STREAM_DURATION = 7 days;

    /// @notice Shares permanently burned on the first deposit, so supply never returns to zero.
    /// @dev Standard defence against the first-depositor share-inflation attack: with a permanent
    ///      dead balance an attacker cannot round later depositors' shares down to zero.
    uint256 internal constant MINIMUM_SHARES = 1_000;

    /// @notice Hard ceiling on the protocol's cut of harvested fees (10%).
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 1_000;

    /// @notice Hook permissions that would let a pool's hook interfere with getting money out.
    ///
    /// @dev v4 encodes which callbacks a hook implements in the low bits of its address, so this
    ///      can be checked once, cheaply, before a vault ever holds funds. A hook with any of these
    ///      could revert a withdrawal or skim a delta off it — which on a vault that other people
    ///      deposit into is a trap, not a fee. Hooks that only touch swaps or only gate *adding*
    ///      liquidity are allowed: the worst those do is make deposits or fee conversion fail,
    ///      which is a liveness annoyance rather than a way to strand somebody's principal.
    uint160 internal constant EXIT_UNSAFE_HOOK_FLAGS = uint160(
        Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
            | Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG | Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG
    );

    /// @notice Hard ceiling on the entry fee (2%).
    ///
    /// @dev Deliberately close to the default. A cap only means something as a promise if it is
    ///      near the rate actually charged — a 10% ceiling on a 0.5% fee tells a depositor almost
    ///      nothing about what they might be charged tomorrow. At 2% the worst case is bounded to
    ///      something a person can accept up front.
    uint16 public constant MAX_DEPOSIT_FEE_BPS = 200;

    /// @notice Hard ceiling on tolerated spot-vs-TWAP divergence for automated swaps (5%).
    uint16 public constant MAX_DEVIATION_BPS = 500;

    /// @notice Minimum averaging window an automated swap must be able to price against.
    uint32 public constant MIN_TWAP_WINDOW = 30 minutes;

    uint256 internal constant BPS = 10_000;
    bytes32 internal constant POSITION_SALT = bytes32(0);

    enum Action {
        Deposit,
        DepositUsdc,
        Withdraw,
        Harvest,
        Compound
    }

    // --- immutable pool configuration ---

    IPoolManager public immutable poolManager;
    Currency public immutable currency0;
    Currency public immutable currency1;

    /// @notice The USDC side of the pair; rewards are denominated and paid in this currency.
    Currency public immutable rewardCurrency;
    /// @notice The non-USDC side of the pair.
    Currency public immutable assetCurrency;
    /// @notice True when currency0 is the USDC side.
    bool public immutable usdcIsCurrency0;

    int24 public immutable tickLower;
    int24 public immutable tickUpper;
    uint160 public immutable sqrtPriceLowerX96;
    uint160 public immutable sqrtPriceUpperX96;

    PoolId public immutable poolId;
    PoolKey internal _poolKey;

    // --- position accounting ---

    /// @notice Liquidity held by the vault's position. Shares are a pro-rata claim on this.
    uint128 public totalLiquidity;

    /// @notice Harvested USDC awaiting compounding back into the position.
    uint256 public pendingCompound;

    /// @notice Asset-side fees held by the vault, awaiting a swap the oracle will permit.
    uint256 public pendingAssetFees;

    /// @notice Protocol fees accrued and awaiting collection by the treasury.
    uint256 public pendingProtocolFees;

    // --- governance-set parameters ---

    address public owner;
    address public treasury;

    /// @notice Protocol's cut of each harvest, in bps.
    ///
    /// @dev This is where the protocol is meant to earn: a share of yield as it is produced, which
    ///      only ever costs a staker when they are already making money. 10% is squarely in line
    ///      with comparable vaults. It is also set to its own ceiling, so the owner can lower this
    ///      but can never raise it — the rate someone sees when they deposit is the worst it gets.
    uint16 public protocolFeeBps = 1_000;

    /// @notice Share of the post-protocol-fee harvest routed to the staker stream; the remainder
    ///         is queued for compounding back into liquidity.
    uint16 public streamBps = 10_000;

    /// @notice Tolerated divergence between spot and TWAP when the vault swaps on its own pool.
    uint16 public maxDeviationBps = 100;

    /// @notice Entry fee, in bps, taken off the top of every deposit.
    ///
    /// @dev A haircut on principal rather than a share of yield: charged on the tokens supplied,
    ///      before any liquidity is added. That makes it the most expensive kind of fee to charge,
    ///      because it costs a depositor whether or not the position ever earns anything, and it
    ///      has to be won back before they are level. Kept small for that reason — the protocol's
    ///      real cut is `protocolFeeBps`, which only bites on yield actually produced.
    ///
    /// @dev Because it reduces what a depositor gets, it is surfaced at the point of deposit and
    ///      written up in the docs rather than left to be discovered from the bytecode.
    uint16 public depositFeeBps = 50;

    /// @notice Where entry fees are sent. Defaults to the treasury until the owner points it
    ///         somewhere else.
    address public feeRecipient;

    /// @notice Entry fees accrued in each currency, awaiting collection by the fee recipient.
    uint256 public pendingDepositFees0;
    uint256 public pendingDepositFees1;

    // --- reward streaming state (Synthetix-style, denominated in rewardCurrency) ---

    uint256 public rewardRate; // reward units per second, scaled by 1e18
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    /// @notice Reward currency owed to stakers but not yet transferred out.
    uint256 public reservedRewards;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    PoolOracle.Oracle internal _oracle;

    // --- events ---

    event Deposited(address indexed sender, address indexed to, uint128 liquidity, uint256 shares);
    event Withdrawn(address indexed sender, address indexed to, uint128 liquidity, uint256 shares);
    event Harvested(uint256 fee0, uint256 fee1, uint256 protocolFee, uint256 streamed, uint256 queued);
    event AssetFeesDeferred(uint256 pendingAssetFees);
    event Compounded(uint256 usdcIn, uint128 liquidityAdded);
    event RewardPaid(address indexed account, uint256 amount);
    event ProtocolFeesCollected(address indexed treasury, uint256 amount);
    event DepositFeeCharged(address indexed payer, uint256 amount0, uint256 amount1);
    event DepositFeesCollected(address indexed to, uint256 amount0, uint256 amount1);
    event DepositFeeUpdated(uint16 depositFeeBps, address indexed feeRecipient);
    event ParametersUpdated(uint16 protocolFeeBps, uint16 streamBps, uint16 maxDeviationBps);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    // --- errors ---

    error NotOwner();
    error NotPoolManager();
    error NativeCurrencyUnsupported();
    error PairMustQuoteUsdc();
    error ZeroAmount();
    error InsufficientShares();
    error SlippageExceeded();
    error PriceOutOfBand();
    error ParameterOutOfRange();
    error NothingToCompound();
    error UnexpectedDebt();
    error HookMayBlockExit(address hooks);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IPoolManager _poolManager,
        PoolKey memory key,
        address _owner,
        address _treasury,
        string memory nameSuffix
    ) ERC20(string.concat("Slice LP ", nameSuffix), string.concat("sLP-", nameSuffix)) {
        if (key.currency0.isAddressZero()) revert NativeCurrencyUnsupported();
        if (_owner == address(0) || _treasury == address(0)) revert ParameterOutOfRange();

        // Refuse the pool outright if its hook could stand between a staker and their exit.
        if (uint160(address(key.hooks)) & EXIT_UNSAFE_HOOK_FLAGS != 0) {
            revert HookMayBlockExit(address(key.hooks));
        }

        bool zeroIsUsdc = Currency.unwrap(key.currency0) == ArcChain.USDC_ERC20;
        bool oneIsUsdc = Currency.unwrap(key.currency1) == ArcChain.USDC_ERC20;
        if (zeroIsUsdc == oneIsUsdc) revert PairMustQuoteUsdc();

        poolManager = _poolManager;
        _poolKey = key;
        poolId = key.toId();
        currency0 = key.currency0;
        currency1 = key.currency1;
        usdcIsCurrency0 = zeroIsUsdc;
        rewardCurrency = zeroIsUsdc ? key.currency0 : key.currency1;
        assetCurrency = zeroIsUsdc ? key.currency1 : key.currency0;

        (int24 lower, int24 upper) = FullRange.ticks(key.tickSpacing);
        tickLower = lower;
        tickUpper = upper;
        sqrtPriceLowerX96 = TickMath.getSqrtPriceAtTick(lower);
        sqrtPriceUpperX96 = TickMath.getSqrtPriceAtTick(upper);

        owner = _owner;
        treasury = _treasury;
        emit OwnerUpdated(address(0), _owner);
        feeRecipient = _treasury;
        emit TreasuryUpdated(address(0), _treasury);
        emit DepositFeeUpdated(depositFeeBps, _treasury);
    }

    // --- views ---

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    /// @notice Current pool price alongside the vault's TWAP of it.
    /// @return ok False while the oracle is still warming up, in which case automated swaps are
    ///         deferred rather than executed at an unverifiable price.
    function prices() external view returns (bool ok, uint160 spotSqrtPriceX96, uint160 twapSqrtPriceX96) {
        (spotSqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        (ok, twapSqrtPriceX96) = _oracle.tryConsult(MIN_TWAP_WINDOW);
    }

    /// @notice Token amounts currently backing `shares`, excluding unclaimed rewards.
    function previewRedeem(uint256 shares) external view returns (uint256 amount0, uint256 amount1) {
        uint256 supply = totalSupply();
        if (supply == 0 || shares == 0) return (0, 0);
        uint128 liq = uint128((uint256(totalLiquidity) * shares) / supply);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        (amount0, amount1) =
            FullRange.amountsForLiquidity(sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96, liq, false);
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate) / supply);
    }

    /// @notice Reward currency claimable by `account` right now.
    function earned(address account) public view returns (uint256) {
        return
            rewards[account] + ((balanceOf(account) * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18);
    }

    // --- staker entrypoints ---

    /// @notice Deposit both sides of the pair and mint shares.
    /// @param amount0Max Maximum currency0 to pull; the unused remainder is refunded.
    /// @param amount1Max Maximum currency1 to pull; the unused remainder is refunded.
    /// @param minShares Revert if fewer shares than this would be minted.
    /// @param to Recipient of the minted shares.
    function deposit(uint256 amount0Max, uint256 amount1Max, uint256 minShares, address to)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (amount0Max == 0 && amount1Max == 0) revert ZeroAmount();
        _harvest();

        if (amount0Max > 0) {
            IERC20(Currency.unwrap(currency0)).safeTransferFrom(msg.sender, address(this), amount0Max);
        }
        if (amount1Max > 0) {
            IERC20(Currency.unwrap(currency1)).safeTransferFrom(msg.sender, address(this), amount1Max);
        }

        // Charged on principal, before anything is deployed, so the position reflects the net.
        (amount0Max, amount1Max) = _chargeDepositFee(amount0Max, amount1Max);

        bytes memory result = poolManager.unlock(abi.encode(Action.Deposit, abi.encode(amount0Max, amount1Max)));
        (uint128 liquidityAdded, uint256 used0, uint256 used1) = abi.decode(result, (uint128, uint256, uint256));

        shares = _mintShares(liquidityAdded, to);
        if (shares < minShares) revert SlippageExceeded();

        if (amount0Max > used0) {
            uint256 back0 = amount0Max - used0;
            back0 += _refundDepositFee(back0, true);
            IERC20(Currency.unwrap(currency0)).safeTransfer(msg.sender, back0);
        }
        if (amount1Max > used1) {
            uint256 back1 = amount1Max - used1;
            back1 += _refundDepositFee(back1, false);
            IERC20(Currency.unwrap(currency1)).safeTransfer(msg.sender, back1);
        }

        emit Deposited(msg.sender, to, liquidityAdded, shares);
    }

    /// @notice Deposit USDC only: the vault swaps half into the asset and adds both sides.
    /// @dev Requires a warm oracle, since it performs a swap on the pool. Depositors can always
    ///      fall back to the two-sided `deposit`, which needs no price opinion at all.
    function depositUsdc(uint256 usdcAmount, uint256 minShares, address to)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (usdcAmount == 0) revert ZeroAmount();
        _harvest();

        IERC20(Currency.unwrap(rewardCurrency)).safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Charged on principal, before anything is deployed. The refund below is computed against
        // the net amount, so the depositor is never refunded money that has already left.
        (uint256 net0, uint256 net1) =
            usdcIsCurrency0 ? _chargeDepositFee(usdcAmount, 0) : _chargeDepositFee(0, usdcAmount);
        usdcAmount = usdcIsCurrency0 ? net0 : net1;

        bytes memory result = poolManager.unlock(abi.encode(Action.DepositUsdc, abi.encode(usdcAmount)));
        (uint128 liquidityAdded, uint256 usdcUsed, uint256 assetRefund) =
            abi.decode(result, (uint128, uint256, uint256));

        shares = _mintShares(liquidityAdded, to);
        if (shares < minShares) revert SlippageExceeded();

        if (usdcAmount > usdcUsed) {
            uint256 back = usdcAmount - usdcUsed;
            back += _refundDepositFee(back, usdcIsCurrency0);
            IERC20(Currency.unwrap(rewardCurrency)).safeTransfer(msg.sender, back);
        }
        if (assetRefund > 0) {
            IERC20(Currency.unwrap(assetCurrency)).safeTransfer(msg.sender, assetRefund);
        }

        emit Deposited(msg.sender, to, liquidityAdded, shares);
    }

    /// @notice Burn shares and withdraw the underlying pro-rata.
    function withdraw(uint256 shares, uint256 amount0Min, uint256 amount1Min, address to)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();
        _harvest();

        uint256 supply = totalSupply();
        uint128 liquidityRemoved = uint128((uint256(totalLiquidity) * shares) / supply);

        _burn(msg.sender, shares);
        totalLiquidity -= liquidityRemoved;

        bytes memory result = poolManager.unlock(abi.encode(Action.Withdraw, abi.encode(liquidityRemoved, to)));
        (amount0, amount1) = abi.decode(result, (uint256, uint256));

        if (amount0 < amount0Min || amount1 < amount1Min) revert SlippageExceeded();
        emit Withdrawn(msg.sender, to, liquidityRemoved, shares);
    }

    /// @notice Transfer accrued reward currency to the caller.
    function claim() external nonReentrant returns (uint256 amount) {
        _updateReward(msg.sender);
        amount = rewards[msg.sender];
        if (amount == 0) return 0;
        rewards[msg.sender] = 0;
        reservedRewards -= amount;
        IERC20(Currency.unwrap(rewardCurrency)).safeTransfer(msg.sender, amount);
        emit RewardPaid(msg.sender, amount);
    }

    /// @notice Send accrued protocol fees to the treasury.
    /// @dev Permissionless, because the destination is fixed: the caller cannot redirect anything.
    ///      Keeping it separate from `harvest` is what stops a blocked or reverting treasury from
    ///      taking the whole vault down with it.
    function collectProtocolFees() external nonReentrant returns (uint256 amount) {
        amount = pendingProtocolFees;
        if (amount == 0) return 0;
        pendingProtocolFees = 0;
        IERC20(Currency.unwrap(rewardCurrency)).safeTransfer(treasury, amount);
        emit ProtocolFeesCollected(treasury, amount);
    }

    // --- keeper entrypoints (permissionless) ---

    /// @notice Record an oracle observation. Anyone may call; required to keep automation live.
    function poke() public {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        _oracle.record(sqrtPriceX96);
    }

    /// @notice Collect accrued swap fees, take the protocol cut, and route the rest to the staker
    ///         stream and/or the compounding queue.
    function harvest() external nonReentrant returns (uint256 streamed, uint256 queued) {
        return _harvest();
    }

    /// @notice Convert queued USDC into additional liquidity, raising NAV for every share.
    /// @dev No shares are minted, so the benefit accrues pro-rata to existing holders.
    function compound() external nonReentrant returns (uint128 liquidityAdded) {
        _harvest();

        uint256 amount = pendingCompound;
        if (amount == 0) revert NothingToCompound();
        pendingCompound = 0;

        bytes memory result = poolManager.unlock(abi.encode(Action.Compound, abi.encode(amount)));
        (uint128 added, uint256 usdcUsed, uint256 assetLeftover) = abi.decode(result, (uint128, uint256, uint256));

        liquidityAdded = added;
        totalLiquidity += added;

        // Anything the position could not absorb stays queued for the next attempt.
        if (amount > usdcUsed) pendingCompound += amount - usdcUsed;
        if (assetLeftover > 0) pendingAssetFees += assetLeftover;

        emit Compounded(usdcUsed, added);
    }

    // --- unlock callback ---

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Action action, bytes memory payload) = abi.decode(data, (Action, bytes));

        if (action == Action.Deposit) return _onDeposit(payload);
        if (action == Action.DepositUsdc) return _onDepositUsdc(payload);
        if (action == Action.Withdraw) return _onWithdraw(payload);
        if (action == Action.Harvest) return _onHarvest();
        return _onCompound(payload);
    }

    function _onDeposit(bytes memory payload) internal returns (bytes memory) {
        (uint256 amount0Max, uint256 amount1Max) = abi.decode(payload, (uint256, uint256));

        uint128 liquidity = _liquidityFor(amount0Max, amount1Max);
        if (liquidity == 0) revert ZeroAmount();
        _modifyLiquidity(int256(uint256(liquidity)));

        (uint256 used0,) = _settleOwed(currency0);
        (uint256 used1,) = _settleOwed(currency1);
        return abi.encode(liquidity, used0, used1);
    }

    function _onDepositUsdc(bytes memory payload) internal returns (bytes memory) {
        uint256 usdcAmount = abi.decode(payload, (uint256));

        // Swap half into the asset so both sides can be added at the prevailing ratio.
        uint256 swapIn = usdcAmount / 2;
        (bool ok, uint256 assetOut, uint256 spent) = _trySwapExactIn(rewardCurrency, swapIn);
        if (!ok) revert PriceOutOfBand();

        // That swap paid LP fees to the vault's own position. Collect and book them to the vault
        // before settling, or the net delta would quietly discount them off what this depositor
        // owes — handing one caller fees that belong to every staker.
        (uint256 usdcFee, uint256 assetFee) = _collectFees();

        // The price band can stop the swap short of `swapIn`, so size the position against what
        // was actually consumed. Using `swapIn` here would understate the USDC still on hand and
        // silently refund a slice of every large single-sided deposit.
        uint256 usdcRemaining = usdcAmount - spent;
        uint128 liquidity = usdcIsCurrency0
            ? _liquidityFor(usdcRemaining, assetOut)
            : _liquidityFor(assetOut, usdcRemaining);
        if (liquidity == 0) revert ZeroAmount();
        _modifyLiquidity(int256(uint256(liquidity)));

        (uint256 usdcPaid,) = _settleOwed(rewardCurrency);
        (, uint256 assetTaken) = _settleOwed(assetCurrency);

        // v4 charges the swap fee on the input currency, so `assetFee` is structurally zero here;
        // it is still clamped rather than assumed, since an underflow would be a free withdrawal.
        if (assetFee > assetTaken) assetFee = assetTaken;

        if (usdcFee > 0) pendingCompound += usdcFee;
        if (assetFee > 0) pendingAssetFees += assetFee;

        return abi.encode(liquidity, usdcPaid + usdcFee, assetTaken - assetFee);
    }

    function _onWithdraw(bytes memory payload) internal returns (bytes memory) {
        (uint128 liquidity, address to) = abi.decode(payload, (uint128, address));
        _modifyLiquidity(-int256(uint256(liquidity)));

        uint256 amount0 = _settleCreditTo(currency0, to);
        uint256 amount1 = _settleCreditTo(currency1, to);
        return abi.encode(amount0, amount1);
    }

    function _onHarvest() internal returns (bytes memory) {
        (uint256 usdcFee, uint256 assetFee) = _collectFees();
        (uint256 fee0, uint256 fee1) = usdcIsCurrency0 ? (usdcFee, assetFee) : (assetFee, usdcFee);

        // Swap the asset side into USDC, together with any asset fees a previous harvest had to
        // defer. If the oracle cannot price the swap, defer again rather than reverting: harvest
        // sits on the deposit and withdraw paths and must never brick them.
        uint256 assetTotal = assetFee + pendingAssetFees;
        bool swapped;
        if (assetTotal > 0) {
            (swapped,,) = _trySwapExactIn(assetCurrency, assetTotal);
        }

        // The swap above pays LP fees to the vault's own position, landing *after* the collection
        // point. Left there, the next deposit's `modifyLiquidity` would net them against that
        // caller's settlement and hand them one staker's share of everyone's fees. Collecting a
        // second time leaves the position with nothing uncollected when the harvest returns.
        if (swapped) _collectFees();

        (uint256 paid, uint256 taken) = _settleOwed(assetCurrency);
        pendingAssetFees = pendingAssetFees + taken - paid;
        if (!swapped && taken > 0) emit AssetFeesDeferred(pendingAssetFees);

        uint256 proceeds = _settleCreditTo(rewardCurrency, address(this));
        return abi.encode(fee0, fee1, proceeds);
    }

    function _onCompound(bytes memory payload) internal returns (bytes memory) {
        uint256 usdcAmount = abi.decode(payload, (uint256));

        uint256 swapIn = usdcAmount / 2;
        (bool ok, uint256 assetOut, uint256 spent) = _trySwapExactIn(rewardCurrency, swapIn);
        if (!ok) revert PriceOutOfBand();

        // Sweep the LP fees this swap paid back to the vault's own position, for the same reason
        // as in `_onHarvest`. Here the accounting is self-correcting: whatever the collect
        // discounts off `usdcUsed` simply reappears as leftover and returns to the queue.
        _collectFees();

        uint256 usdcRemaining = usdcAmount - spent;
        uint128 liquidity = usdcIsCurrency0
            ? _liquidityFor(usdcRemaining, assetOut)
            : _liquidityFor(assetOut, usdcRemaining);
        if (liquidity > 0) _modifyLiquidity(int256(uint256(liquidity)));

        (uint256 usdcUsed,) = _settleOwed(rewardCurrency);
        (, uint256 assetLeftover) = _settleOwed(assetCurrency);
        return abi.encode(liquidity, usdcUsed, assetLeftover);
    }

    // --- internal: pool interaction ---

    function _modifyLiquidity(int256 liquidityDelta) internal returns (BalanceDelta feesAccrued) {
        (, feesAccrued) = poolManager.modifyLiquidity(
            _poolKey,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: POSITION_SALT
            }),
            ""
        );
    }

    /// @notice Collect the position's accrued fees, returned split by role rather than by index.
    /// @dev A zero liquidity delta collects fees and nothing else, so the returned delta is purely
    ///      fee income and is always a credit.
    function _collectFees() internal returns (uint256 usdcFee, uint256 assetFee) {
        BalanceDelta feesAccrued = _modifyLiquidity(0);
        int128 d0 = feesAccrued.amount0();
        int128 d1 = feesAccrued.amount1();
        uint256 fee0 = d0 > 0 ? uint256(uint128(d0)) : 0;
        uint256 fee1 = d1 > 0 ? uint256(uint128(d1)) : 0;
        return usdcIsCurrency0 ? (fee0, fee1) : (fee1, fee0);
    }

    function _liquidityFor(uint256 amount0Max, uint256 amount1Max) internal view returns (uint128) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        return LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtPriceLowerX96, sqrtPriceUpperX96, amount0Max, amount1Max
        );
    }

    /// @notice Settle the vault's *net* outstanding delta in `currency`, paying a debt from the
    ///         vault's own balance or collecting a credit into the vault.
    /// @dev v4 accumulates deltas per currency across the whole unlock, so settling each
    ///      operation's individual delta would leave earlier credits stranded and trip
    ///      CurrencyNotSettled. Everything here reads the net figure instead.
    function _settleOwed(Currency currency) internal returns (uint256 paid, uint256 taken) {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta < 0) {
            paid = uint256(-delta);
            Settler.pay(currency, poolManager, paid);
        } else if (delta > 0) {
            taken = uint256(delta);
            Settler.collect(currency, poolManager, address(this), taken);
        }
    }

    /// @notice Collect the vault's net credit in `currency` straight to `recipient`.
    function _settleCreditTo(Currency currency, address recipient) internal returns (uint256 amount) {
        int256 delta = poolManager.currencyDelta(address(this), currency);
        if (delta < 0) revert UnexpectedDebt();
        if (delta == 0) return 0;
        amount = uint256(delta);
        Settler.collect(currency, poolManager, recipient, amount);
    }

    /// @notice Swap `amountIn` of `tokenIn` for the other side on the vault's own pool.
    /// @dev Returns false without swapping when the oracle is not warm enough to price the trade
    ///      or spot has diverged from the TWAP by more than `maxDeviationBps`. The resulting
    ///      credit and debt are left in the PoolManager for the caller to settle net.
    function _trySwapExactIn(Currency tokenIn, uint256 amountIn)
        internal
        returns (bool ok, uint256 amountOut, uint256 amountSpent)
    {
        if (amountIn == 0) return (false, 0, 0);

        (bool warm, uint160 twapSqrtPriceX96) = _oracle.tryConsult(MIN_TWAP_WINDOW);
        if (!warm) return (false, 0, 0);

        (uint160 spotSqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        if (PoolOracle.deviationBps(spotSqrtPriceX96, twapSqrtPriceX96) > maxDeviationBps) return (false, 0, 0);

        bool zeroForOne = Currency.unwrap(tokenIn) == Currency.unwrap(currency0);
        BalanceDelta swapDelta = poolManager.swap(
            _poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                // Anchored to spot, not the TWAP. The two checks do different jobs: the deviation
                // test above rejects a dislocated *starting* price, while this limit caps how far
                // this swap may move it. Deriving the limit from the TWAP conflates them — when
                // spot sits legitimately inside the band but on the far side of the average, the
                // limit lands the wrong side of spot and v4 rejects the swap outright.
                sqrtPriceLimitX96: _sqrtPriceLimit(spotSqrtPriceX96, zeroForOne)
            }),
            ""
        );

        int128 outDelta = zeroForOne ? swapDelta.amount1() : swapDelta.amount0();
        int128 inDelta = zeroForOne ? swapDelta.amount0() : swapDelta.amount1();
        return (true, uint256(uint128(outDelta)), uint256(uint128(-inDelta)));
    }

    /// @notice A sqrt-price bound `maxDeviationBps` from the current price, in the swap direction.
    /// @dev The bound is applied to sqrt price, so the implied bound on price is roughly twice
    ///      `maxDeviationBps`. That headroom is intentional: the deviation check in the caller
    ///      already rejects a dislocated starting price, and this limit only caps the swap's own
    ///      impact. Passing spot rather than the TWAP guarantees the limit is always on the far
    ///      side of the current price, so it can bind the swap but never reject it up front.
    function _sqrtPriceLimit(uint160 refSqrtPriceX96, bool zeroForOne) internal view returns (uint160) {
        uint256 bounded = zeroForOne
            ? (uint256(refSqrtPriceX96) * (BPS - maxDeviationBps)) / BPS
            : (uint256(refSqrtPriceX96) * (BPS + maxDeviationBps)) / BPS;

        uint256 floorPrice = uint256(TickMath.MIN_SQRT_PRICE) + 1;
        uint256 ceilPrice = uint256(TickMath.MAX_SQRT_PRICE) - 1;
        if (bounded < floorPrice) bounded = floorPrice;
        if (bounded > ceilPrice) bounded = ceilPrice;
        // casting to 'uint160' is safe because bounded is clamped to at most MAX_SQRT_PRICE - 1
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(bounded);
    }

    // --- internal: accounting ---

    function _harvest() internal returns (uint256 streamed, uint256 queued) {
        poke();

        // v4 rejects a zero-delta update against an empty position, so there is nothing to
        // harvest before the first deposit or after the last withdrawal. Any asset-side fees
        // deferred earlier stay queued and are swapped once liquidity returns.
        if (totalLiquidity == 0) return (0, 0);

        bytes memory result = poolManager.unlock(abi.encode(Action.Harvest, bytes("")));
        (uint256 fee0, uint256 fee1, uint256 proceeds) = abi.decode(result, (uint256, uint256, uint256));

        if (proceeds == 0) return (0, 0);

        // Accrue the protocol fee rather than pushing it. Arc's USDC consults Circle's compliance
        // precompile on every transfer and reverts for a blocklisted party. A push here would put
        // that third-party decision on the critical path of `harvest`, which runs at the top of
        // deposit, withdraw and compound — so blocklisting the treasury would freeze the vault
        // permanently, users' withdrawals included. Pull-based, a blocked treasury only fails its
        // own collection.
        uint256 protocolCut = (proceeds * protocolFeeBps) / BPS;
        if (protocolCut > 0) pendingProtocolFees += protocolCut;
        uint256 distributable = proceeds - protocolCut;

        streamed = (distributable * streamBps) / BPS;
        queued = distributable - streamed;

        // With no stakers there is nobody to stream to, so route the whole harvest into liquidity
        // instead of letting it accrue to a zero-supply reward index and become unclaimable.
        if (totalSupply() == 0) {
            queued += streamed;
            streamed = 0;
        }

        if (streamed > 0) _notifyReward(streamed);
        if (queued > 0) pendingCompound += queued;

        emit Harvested(fee0, fee1, protocolCut, streamed, queued);
    }

    /// @notice Take the entry fee off the supplied amounts, accruing it, and return the remainder.
    ///
    /// @dev Accrued rather than pushed, for the same reason protocol fees are. Arc's USDC reverts
    ///      for a blocklisted party, so transferring to the fee recipient inline would put that
    ///      third-party decision on the deposit path: blocklist the recipient and deposits stop
    ///      working for everyone. Accruing keeps the deposit path free of any transfer that
    ///      somebody else can make fail. `ProtocolFees.t.sol` covers this.
    ///
    /// @dev Kept in its own bucket rather than mixed into `pendingCompound`, so it is never part of
    ///      any staker's claim and stays distinguishable from the protocol's share of harvested
    ///      yield, which is a different mechanism with a different recipient.
    function _chargeDepositFee(uint256 amount0, uint256 amount1)
        internal
        returns (uint256 net0, uint256 net1)
    {
        uint16 bps = depositFeeBps;
        if (bps == 0) return (amount0, amount1);

        uint256 fee0 = (amount0 * bps) / BPS;
        uint256 fee1 = (amount1 * bps) / BPS;
        if (fee0 == 0 && fee1 == 0) return (amount0, amount1);

        if (fee0 > 0) pendingDepositFees0 += fee0;
        if (fee1 > 0) pendingDepositFees1 += fee1;

        emit DepositFeeCharged(msg.sender, fee0, fee1);
        return (amount0 - fee0, amount1 - fee1);
    }

    /// @notice Give back the entry fee that was charged on a portion now being refunded.
    ///
    /// @dev `deposit` takes *maximum* amounts and hands back whatever the position could not
    ///      absorb at the pool's current ratio, so supplying generously on one side is the normal
    ///      way to use it. The fee therefore has to follow the money: capital that never reached
    ///      the pool was never deployed, and charging for it turns a 0.5% fee into an arbitrarily
    ///      large one on a lopsided deposit.
    ///
    /// @dev `leftoverNet` is already net of the fee, so the gross it was taken from is
    ///      `leftoverNet * BPS / (BPS - bps)` and the fee on it is the difference, which reduces
    ///      to `leftoverNet * bps / (BPS - bps)`. Integer division rounds the refund down, leaving
    ///      at most a wei with the protocol rather than overpaying it out.
    function _refundDepositFee(uint256 leftoverNet, bool isCurrency0) internal returns (uint256 feeBack) {
        uint16 bps = depositFeeBps;
        if (bps == 0 || leftoverNet == 0) return 0;

        feeBack = (leftoverNet * bps) / (BPS - bps);
        if (isCurrency0) {
            if (feeBack > pendingDepositFees0) feeBack = pendingDepositFees0;
            pendingDepositFees0 -= feeBack;
        } else {
            if (feeBack > pendingDepositFees1) feeBack = pendingDepositFees1;
            pendingDepositFees1 -= feeBack;
        }
    }

    /// @notice Send accrued entry fees to the fee recipient.
    /// @dev Permissionless, because the destination is fixed — the caller cannot redirect anything.
    function collectDepositFees() external nonReentrant returns (uint256 fee0, uint256 fee1) {
        fee0 = pendingDepositFees0;
        fee1 = pendingDepositFees1;
        if (fee0 == 0 && fee1 == 0) return (0, 0);

        pendingDepositFees0 = 0;
        pendingDepositFees1 = 0;

        address to = feeRecipient;
        if (fee0 > 0) IERC20(Currency.unwrap(currency0)).safeTransfer(to, fee0);
        if (fee1 > 0) IERC20(Currency.unwrap(currency1)).safeTransfer(to, fee1);

        emit DepositFeesCollected(to, fee0, fee1);
    }

    /// @notice The entry fee that would be charged on `amount0`/`amount1`, for display.
    function previewDepositFee(uint256 amount0, uint256 amount1)
        external
        view
        returns (uint256 fee0, uint256 fee1)
    {
        uint16 bps = depositFeeBps;
        return ((amount0 * bps) / BPS, (amount1 * bps) / BPS);
    }

    function _mintShares(uint128 liquidityAdded, address to) internal returns (uint256 shares) {
        uint256 supply = totalSupply();
        uint128 liquidityBefore = totalLiquidity;

        if (supply == 0) {
            if (liquidityAdded <= MINIMUM_SHARES) revert ZeroAmount();
            shares = uint256(liquidityAdded) - MINIMUM_SHARES;
            _mint(address(0xdead), MINIMUM_SHARES);
        } else {
            shares = (uint256(liquidityAdded) * supply) / liquidityBefore;
            if (shares == 0) revert ZeroAmount();
        }

        totalLiquidity = liquidityBefore + liquidityAdded;
        _mint(to, shares);
    }

    /// @notice Begin (or extend) a linear payout of `amount` over STREAM_DURATION.
    function _notifyReward(uint256 amount) internal {
        _updateReward(address(0));

        if (block.timestamp >= periodFinish) {
            rewardRate = (amount * 1e18) / STREAM_DURATION;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = (remaining * rewardRate) / 1e18;
            rewardRate = ((amount + leftover) * 1e18) / STREAM_DURATION;
        }

        reservedRewards += amount;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + STREAM_DURATION;
    }

    function _updateReward(address account) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }

    /// @dev Reward accounting must follow every share balance change, including transfers.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) _updateReward(from);
        if (to != address(0) && to != from) _updateReward(to);
        super._update(from, to, value);
    }

    // --- governance ---

    function setParameters(uint16 _protocolFeeBps, uint16 _streamBps, uint16 _maxDeviationBps) external onlyOwner {
        if (_protocolFeeBps > MAX_PROTOCOL_FEE_BPS) revert ParameterOutOfRange();
        if (_streamBps > BPS) revert ParameterOutOfRange();
        if (_maxDeviationBps == 0 || _maxDeviationBps > MAX_DEVIATION_BPS) revert ParameterOutOfRange();
        protocolFeeBps = _protocolFeeBps;
        streamBps = _streamBps;
        maxDeviationBps = _maxDeviationBps;
        emit ParametersUpdated(_protocolFeeBps, _streamBps, _maxDeviationBps);
    }

    function setDepositFee(uint16 _depositFeeBps, address _feeRecipient) external onlyOwner {
        if (_depositFeeBps > MAX_DEPOSIT_FEE_BPS) revert ParameterOutOfRange();
        if (_feeRecipient == address(0)) revert ParameterOutOfRange();
        depositFeeBps = _depositFeeBps;
        feeRecipient = _feeRecipient;
        emit DepositFeeUpdated(_depositFeeBps, _feeRecipient);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ParameterOutOfRange();
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setOwner(address _owner) external onlyOwner {
        if (_owner == address(0)) revert ParameterOutOfRange();
        emit OwnerUpdated(owner, _owner);
        owner = _owner;
    }
}
