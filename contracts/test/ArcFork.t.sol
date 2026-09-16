// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultDeployer} from "../src/VaultDeployer.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {BlocklistERC20} from "./mocks/BlocklistERC20.sol";

/// @notice The protocol exercised against live Arc state.
///
/// The rest of the suite runs on a locally deployed PoolManager. These tests fork Arc and use the
/// *real* one, which catches the class of problem a local fixture cannot: a PoolManager on a
/// different version than the one vendored in lib/, an EVM configured differently from the test
/// EVM, or a chain whose USDC does not behave like an ordinary ERC-20.
///
/// Arc's USDC turns out to be exactly that last case. It is a thin wrapper over two chain
/// precompiles — a compliance check at 0x1800…0001 and a native balance move at 0x1800…0000 —
/// neither of which exists in Foundry's EVM. Reads work; transfers cannot execute in a fork at
/// all. So the tests split:
///
///   - `test_usdcErc20MirrorsNativeBalance…` and `test_realUsdcRefusesBlocklistedParties` run
///     against the real token and pin the two assumptions the protocol makes about it.
///   - The lifecycle tests etch a standard ERC-20 over the USDC address so balances actually move.
///     The real PoolManager is still the subject there, which is the point.
///
/// Skipped unless ARC_TESTNET_RPC_URL is set, so `forge test` stays offline by default:
///   ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.io forge test --match-contract ArcFork -vv
contract ArcForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    /// @dev Circle's compliance precompile, consulted by USDC on every transfer.
    address constant BLOCKLIST_PRECOMPILE = 0x1800000000000000000000000000000000000001;

    IPoolManager manager = IPoolManager(ArcChain.POOL_MANAGER);

    BlocklistERC20 token;
    PoolSwapTest swapRouter;
    VaultFactory factory;
    LiquidityVault vault;
    PoolKey key;
    bool usdcFirst;

    address alice = makeAddr("alice");
    address treasury = makeAddr("treasury");

    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;

        vm.createSelectFork(rpc);
        forked = true;

        assertGt(ArcChain.POOL_MANAGER.code.length, 0, "no PoolManager on the forked chain");
        assertGt(ArcChain.USDC_ERC20.code.length, 0, "no USDC on the forked chain");
    }

    modifier onlyForked() {
        if (!forked) {
            console2.log("SKIPPED: set ARC_TESTNET_RPC_URL to run the fork suite");
            return;
        }
        _;
    }

    // --- assumptions about the real USDC contract ---

    /// @notice Arc's USDC ERC-20 is a view onto the native balance, not a separate ledger.
    /// @dev The whole protocol depends on this. If crediting a native balance did not surface
    ///      through the 6-decimal ERC-20 view, every deposit path would read the wrong number.
    function test_usdcErc20MirrorsNativeBalanceAcrossTheDecimalGap() public onlyForked {
        vm.deal(alice, 1_000e18); // 1,000 USDC at native 18-decimal precision

        uint256 seen = IERC20(ArcChain.USDC_ERC20).balanceOf(alice);
        console2.log("native (18dp)    ", alice.balance);
        console2.log("erc20  (6dp)     ", seen);

        assertEq(seen, 1_000e6, "ERC-20 view does not mirror the native balance at 6 decimals");
        assertEq(alice.balance / ArcChain.USDC_SCALE, seen, "the 1e12 scale factor does not hold");
    }

    /// @notice Real USDC refuses to move for a blocklisted party.
    /// @dev This is the hazard that forced protocol fees to be pull-based. Circle decides who is
    ///      blocked, so any USDC push sitting on a shared code path is a freeze vector controlled
    ///      by a third party. Proven here against the real token rather than taken on faith.
    function test_realUsdcRefusesBlocklistedParties() public onlyForked {
        vm.deal(alice, 1_000e18);

        // The precompile has no implementation in a fork, so mockCall needs code to attach to.
        vm.etch(BLOCKLIST_PRECOMPILE, hex"00");
        vm.mockCall(
            BLOCKLIST_PRECOMPILE, abi.encodeWithSignature("isBlocklisted(address)", alice), abi.encode(true)
        );

        vm.prank(alice);
        vm.expectRevert();
        IERC20(ArcChain.USDC_ERC20).transfer(treasury, 1e6);
    }

    // --- the protocol, against the real PoolManager ---

    function test_fullLifecycleAgainstRealPoolManager() public onlyForked {
        _deployProtocol();

        BlocklistERC20 usdc = BlocklistERC20(ArcChain.USDC_ERC20);
        usdc.mint(alice, 10_000e6);
        token.mint(alice, 10_000e18);

        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        token.approve(address(vault), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        // --- stake ---
        (uint256 a0, uint256 a1) =
            usdcFirst ? (uint256(5_000e6), uint256(5_000e18)) : (uint256(5_000e18), uint256(5_000e6));
        uint256 shares = vault.deposit(a0, a1, 0, alice);
        assertGt(shares, 0, "no shares minted against the real PoolManager");
        console2.log("shares           ", shares);

        // --- real swap fees on a real pool ---
        _swap(usdcFirst, 500e6);
        _swap(!usdcFirst, 500e18);
        vm.stopPrank();

        // --- harvest with a cold oracle: must defer, never revert ---
        vault.harvest();
        uint256 deferred = vault.pendingAssetFees();
        assertGt(deferred, 0, "token-side fees were not deferred while the oracle was cold");
        console2.log("deferred (token) ", deferred);

        // --- warm the oracle, then harvest for real ---
        vault.poke();
        vm.warp(block.timestamp + vault.MIN_TWAP_WINDOW() + 1);
        vault.poke();

        (bool warm,,) = vault.prices();
        assertTrue(warm, "oracle did not warm after the TWAP window");

        // The first harvest already streamed the USDC side, and 30 minutes have since elapsed, so
        // Alice has legitimately accrued something. Measure against that, not against zero.
        uint256 accruedBeforeHarvest = vault.earned(alice);

        vault.harvest();
        assertLt(vault.pendingAssetFees(), deferred / 100, "deferred fees never converted");
        assertGt(vault.rewardRate(), 0, "fee stream never started");
        console2.log("reward rate      ", vault.rewardRate());

        // --- the stream pays out over seven days, never as a lump ---
        assertEq(
            vault.earned(alice),
            accruedBeforeHarvest,
            "the harvest became claimable instantly rather than streaming"
        );
        vm.warp(block.timestamp + vault.STREAM_DURATION());

        uint256 owed = vault.earned(alice);
        assertGt(owed, 0, "nothing accrued across the full stream");
        console2.log("claimable (usdc) ", owed);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 claimed = vault.claim();
        assertEq(claimed, owed, "claim paid a different amount than earned");
        assertEq(usdc.balanceOf(alice) - before, claimed, "USDC never reached the staker");

        // --- protocol fee accrued, and collectible ---
        assertGt(vault.pendingProtocolFees(), 0, "protocol fee never accrued");
        assertGt(vault.collectProtocolFees(), 0, "protocol fee not collectible");
        assertGt(usdc.balanceOf(treasury), 0, "treasury never paid");

        // --- exit ---
        vm.prank(alice);
        (uint256 out0, uint256 out1) = vault.withdraw(shares, 0, 0, alice);
        assertGt(out0, 0, "withdraw returned nothing for currency0");
        assertGt(out1, 0, "withdraw returned nothing for currency1");
        assertEq(vault.balanceOf(alice), 0, "shares survived the withdrawal");
    }

    /// @notice A creator router injecting liquidity on a real pool, with the shares burned.
    function test_feeRouterInjectsAgainstRealPoolManager() public onlyForked {
        _deployProtocol();

        BlocklistERC20 usdc = BlocklistERC20(ArcChain.USDC_ERC20);
        usdc.mint(alice, 10_000e6);
        token.mint(alice, 10_000e18);

        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        token.approve(address(vault), type(uint256).max);
        (uint256 a0, uint256 a1) =
            usdcFirst ? (uint256(5_000e6), uint256(5_000e18)) : (uint256(5_000e18), uint256(5_000e6));
        vault.deposit(a0, a1, 0, alice);
        vm.stopPrank();

        // Warm the oracle so an injection can be priced.
        vault.poke();
        vm.warp(block.timestamp + vault.MIN_TWAP_WINDOW() + 1);
        vault.poke();

        address burn = address(0xdEaD);
        vm.prank(alice);
        FeeRouter router = FeeRouter(factory.createRouter(address(vault), burn));

        vm.startPrank(alice);
        router.configureCadence(1 days, 10_000, 0);
        usdc.approve(address(router), type(uint256).max);
        router.fund(50e6);
        vm.stopPrank();

        (bool ok, uint256 cap) = router.marketCap();
        assertTrue(ok, "market cap unreadable with a warm oracle");
        assertGt(cap, 0, "market cap priced at zero");
        console2.log("market cap (usdc)", cap);

        vm.warp(block.timestamp + 1 days);
        uint256 burnedBefore = vault.balanceOf(burn);
        uint256 liquidityBefore = vault.totalLiquidity();
        uint256 creatorSharesBefore = vault.balanceOf(alice);

        // Permissionless — a keeper unrelated to the creator fires it.
        vm.prank(makeAddr("keeper"));
        (uint256 amount, uint256 minted) = router.inject();

        assertGt(amount, 0, "injection deployed nothing");
        assertGt(minted, 0, "injection minted no shares");
        assertGt(vault.totalLiquidity(), liquidityBefore, "injection added no liquidity");
        assertEq(vault.balanceOf(burn) - burnedBefore, minted, "shares did not reach the burn address");
        assertEq(vault.balanceOf(address(router)), 0, "router retained a claim on injected liquidity");
        assertEq(vault.balanceOf(alice), creatorSharesBefore, "creator gained a claim on injected liquidity");
        console2.log("injected (usdc)  ", amount);
        console2.log("burned shares    ", minted);
    }

    // --- helpers ---

    /// @dev Swaps a standard ERC-20 in at the USDC address. The real token cannot execute a
    ///      transfer in a fork (see the contract-level comment), and the subject of these tests is
    ///      the PoolManager, not the token.
    function _deployProtocol() internal {
        deployCodeTo(
            "BlocklistERC20.sol:BlocklistERC20",
            abi.encode("USD Coin", "USDC", uint8(6)),
            ArcChain.USDC_ERC20
        );

        token = new BlocklistERC20("Delta Test Token", "DTT", 18);
        swapRouter = new PoolSwapTest(manager);

        VaultDeployer deployer = new VaultDeployer();
        factory = new VaultFactory(manager, deployer, address(this), treasury);
        deployer.setFactory(address(factory));

        usdcFirst = ArcChain.USDC_ERC20 < address(token);
        key = PoolKey({
            currency0: Currency.wrap(usdcFirst ? ArcChain.USDC_ERC20 : address(token)),
            currency1: Currency.wrap(usdcFirst ? address(token) : ArcChain.USDC_ERC20),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        manager.initialize(
            key, usdcFirst ? uint160(1e6 * (uint256(1) << 96)) : uint160((uint256(1) << 96) / 1e6)
        );
        vault = LiquidityVault(factory.createVault(key));
    }

    function _swap(bool zeroForOne, uint256 amountIn) internal {
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }
}
