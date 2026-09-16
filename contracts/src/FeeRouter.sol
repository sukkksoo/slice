// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";

import {LiquidityVault} from "./LiquidityVault.sol";

/// @title FeeRouter
/// @notice Creator-side automation: accumulate USDC and inject it into a pool's liquidity on a
///         schedule, or as the token crosses market-cap milestones.
///
/// @dev The router deliberately does not care *where* its USDC comes from. A launchpad routing a
///      share of trading fees, a creator wiring a manual budget, and a treasury topping the
///      balance up all look identical: USDC lands on this contract. That keeps the router
///      compatible with any fee source on Arc rather than coupling it to one launchpad's
///      interface, which is what a v4 hook-based capture would have forced.
///
/// @dev Injected liquidity is deposited into a LiquidityVault and the resulting shares are sent to
///      `injectionRecipient`. Pointing that at a burn address makes the injection permanent — the
///      liquidity can never be pulled back out, which is the guarantee most creators actually want
///      to make to their holders. Pointing it at the creator keeps the position redeemable.
///
/// @dev Market-cap triggers read the vault's TWAP, never spot. A spot-priced milestone would let
///      anyone push the price through a threshold inside one block and force an injection at a
///      price of their choosing.
contract FeeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Mode {
        Cadence,
        Milestone
    }

    uint256 internal constant BPS = 10_000;
    uint256 internal constant Q96 = 1 << 96;

    /// @notice Floor on the configurable interval, so cadence mode cannot become a per-block drip.
    uint32 public constant MIN_INTERVAL = 1 hours;

    LiquidityVault public immutable vault;
    IERC20 public immutable usdc;
    IERC20Metadata public immutable asset;

    address public creator;

    /// @notice Recipient of the vault shares minted by each injection.
    address public injectionRecipient;

    Mode public mode;

    /// @notice Cadence mode: minimum seconds between injections.
    uint32 public intervalSeconds = 1 days;
    /// @notice Timestamp of the most recent injection.
    uint32 public lastInjectionAt;

    /// @notice Share of the router's USDC balance deployed per injection, in bps.
    uint16 public injectionBps = 2_500;
    /// @notice Injections below this size are rejected, so gas never exceeds the amount deployed.
    uint256 public minInjection;

    /// @notice Milestone mode: market caps, in 6-decimal USDC, that each trigger one injection.
    /// @dev Strictly ascending, consumed in order, each firing exactly once.
    uint256[] public milestones;
    /// @notice Index of the next milestone to fire.
    uint256 public nextMilestone;

    event Funded(address indexed from, uint256 amount);
    event Injected(uint256 usdcAmount, uint256 sharesMinted, address indexed to, Mode mode, uint256 marketCap);
    event CadenceConfigured(uint32 intervalSeconds, uint16 injectionBps, uint256 minInjection);
    event MilestonesConfigured(uint256[] milestones, uint16 injectionBps, uint256 minInjection);
    event RecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event CreatorUpdated(address indexed previousCreator, address indexed newCreator);
    event Swept(address indexed to, uint256 amount);

    error NotCreator();
    error ZeroAddress();
    error IntervalTooShort();
    error InvalidBps();
    error MilestonesNotAscending();
    error NoMilestones();
    error NotDue();
    error BelowMinimum();
    error OracleNotReady();

    modifier onlyCreator() {
        if (msg.sender != creator) revert NotCreator();
        _;
    }

    constructor(LiquidityVault _vault, address _creator, address _injectionRecipient) {
        if (_creator == address(0) || _injectionRecipient == address(0)) revert ZeroAddress();

        vault = _vault;
        usdc = IERC20(Currency.unwrap(_vault.rewardCurrency()));
        asset = IERC20Metadata(Currency.unwrap(_vault.assetCurrency()));
        creator = _creator;
        injectionRecipient = _injectionRecipient;
        lastInjectionAt = uint32(block.timestamp);

        emit CreatorUpdated(address(0), _creator);
        emit RecipientUpdated(address(0), _injectionRecipient);
    }

    // --- funding ---

    /// @notice Pull `amount` of USDC from the caller into the router's budget.
    /// @dev A plain transfer to this address works just as well; this entrypoint only exists so
    ///      funding emits an event that indexers can attribute.
    function fund(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // --- views ---

    /// @notice Fully diluted market cap of the asset, in 6-decimal USDC, priced off the TWAP.
    /// @return ok False while the vault's oracle is still warming up.
    function marketCap() public view returns (bool ok, uint256 cap) {
        (bool warm,, uint160 twapSqrtPriceX96) = vault.prices();
        if (!warm || twapSqrtPriceX96 == 0) return (false, 0);

        uint256 supply = asset.totalSupply();
        if (supply == 0) return (true, 0);

        // FullMath reverts if a quotient exceeds uint256, and `marketCap` sits inside the view
        // `injectable()` that the dashboard and keepers call. A token with an absurd supply would
        // therefore brick those reads rather than simply reporting "not ready". No real token
        // approaches 2^128 units, so anything above that is reported as unpriceable instead.
        if (supply > type(uint128).max) return (false, 0);

        // Uniswap prices raw units against raw units: price = amount1 / amount0. Converting the
        // whole asset supply into the USDC side therefore needs no decimal adjustment, only the
        // right direction. Each multiply is split in two mulDivs because sqrtPriceX96 squared
        // overflows uint256.
        if (vault.usdcIsCurrency0()) {
            // USDC is currency0, so the pool price is asset-per-USDC; invert it.
            cap = FullMath.mulDiv(FullMath.mulDiv(supply, Q96, twapSqrtPriceX96), Q96, twapSqrtPriceX96);
        } else {
            // Asset is currency0, so the pool price is already USDC-per-asset.
            cap = FullMath.mulDiv(FullMath.mulDiv(supply, twapSqrtPriceX96, Q96), twapSqrtPriceX96, Q96);
        }
        ok = true;
    }

    /// @notice Whether `inject` would succeed right now, and how much it would deploy.
    function injectable() public view returns (bool ready, uint256 amount) {
        amount = (usdc.balanceOf(address(this)) * injectionBps) / BPS;
        if (amount == 0 || amount < minInjection) return (false, amount);

        if (mode == Mode.Cadence) {
            return (block.timestamp >= uint256(lastInjectionAt) + intervalSeconds, amount);
        }

        if (nextMilestone >= milestones.length) return (false, amount);
        (bool ok, uint256 cap) = marketCap();
        if (!ok) return (false, amount);
        return (cap >= milestones[nextMilestone], amount);
    }

    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    // --- automation ---

    /// @notice Record a price observation on the vault's oracle. Anyone may call.
    /// @dev Milestone mode is only as responsive as the oracle is fresh, so keepers should poke on
    ///      a cadence well under the vault's TWAP window.
    function poke() external {
        vault.poke();
    }

    /// @notice Deploy the next tranche of the budget into pool liquidity, if the trigger is met.
    /// @dev Permissionless: the trigger conditions, not the caller, decide whether this is valid.
    function inject() external nonReentrant returns (uint256 amount, uint256 shares) {
        vault.poke();

        uint256 cap;
        if (mode == Mode.Cadence) {
            if (block.timestamp < uint256(lastInjectionAt) + intervalSeconds) revert NotDue();
        } else {
            if (nextMilestone >= milestones.length) revert NoMilestones();
            bool ok;
            (ok, cap) = marketCap();
            if (!ok) revert OracleNotReady();
            if (cap < milestones[nextMilestone]) revert NotDue();
        }

        amount = (usdc.balanceOf(address(this)) * injectionBps) / BPS;
        if (amount == 0 || amount < minInjection) revert BelowMinimum();

        // Advance the trigger before depositing, so a milestone cannot be replayed even if the
        // deposit path were ever to hand control back to the caller.
        lastInjectionAt = uint32(block.timestamp);
        if (mode == Mode.Milestone) nextMilestone += 1;

        usdc.forceApprove(address(vault), amount);
        // minShares is zero because the vault enforces its own TWAP price band on the internal
        // swap; a share-count floor here would be a second, weaker version of the same check.
        shares = vault.depositUsdc(amount, 0, injectionRecipient);
        usdc.forceApprove(address(vault), 0);

        emit Injected(amount, shares, injectionRecipient, mode, cap);
    }

    // --- configuration ---

    function configureCadence(uint32 _intervalSeconds, uint16 _injectionBps, uint256 _minInjection)
        external
        onlyCreator
    {
        if (_intervalSeconds < MIN_INTERVAL) revert IntervalTooShort();
        if (_injectionBps == 0 || _injectionBps > BPS) revert InvalidBps();

        mode = Mode.Cadence;
        intervalSeconds = _intervalSeconds;
        injectionBps = _injectionBps;
        minInjection = _minInjection;

        emit CadenceConfigured(_intervalSeconds, _injectionBps, _minInjection);
    }

    function configureMilestones(uint256[] calldata _milestones, uint16 _injectionBps, uint256 _minInjection)
        external
        onlyCreator
    {
        if (_milestones.length == 0) revert NoMilestones();
        if (_injectionBps == 0 || _injectionBps > BPS) revert InvalidBps();
        for (uint256 i = 1; i < _milestones.length; i++) {
            if (_milestones[i] <= _milestones[i - 1]) revert MilestonesNotAscending();
        }

        mode = Mode.Milestone;
        milestones = _milestones;
        nextMilestone = 0;
        injectionBps = _injectionBps;
        minInjection = _minInjection;

        emit MilestonesConfigured(_milestones, _injectionBps, _minInjection);
    }

    function setInjectionRecipient(address _recipient) external onlyCreator {
        if (_recipient == address(0)) revert ZeroAddress();
        emit RecipientUpdated(injectionRecipient, _recipient);
        injectionRecipient = _recipient;
    }

    function setCreator(address _creator) external onlyCreator {
        if (_creator == address(0)) revert ZeroAddress();
        emit CreatorUpdated(creator, _creator);
        creator = _creator;
    }

    /// @notice Withdraw unspent budget back to the creator.
    /// @dev The budget is the creator's own capital, so it stays withdrawable. Creators who want
    ///      to promise otherwise should fund from a contract that enforces the lock, and point
    ///      `injectionRecipient` at a burn address so deployed liquidity is permanent regardless.
    function sweep(address to, uint256 amount) external onlyCreator {
        if (to == address(0)) revert ZeroAddress();
        usdc.safeTransfer(to, amount);
        emit Swept(to, amount);
    }
}
