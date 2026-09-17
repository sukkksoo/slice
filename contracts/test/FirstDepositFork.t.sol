// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultDeployer} from "../src/VaultDeployer.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {BlocklistERC20} from "./mocks/BlocklistERC20.sol";

/// @notice The reported failure, reproduced and then fixed, against the real pool it happened on.
///
/// A staker found the ARC 101 vault listed and live, entered one dollar in USDC-only mode, and the
/// transaction reverted after the approval went through. The vault held nothing at the time — they
/// would have been the first — and the revert came back as v4's `CannotUpdateEmptyPosition`, from
/// the fee collection that runs immediately after the deposit's swap.
///
/// This builds a fresh vault on that same pool, with the same real Argus hook, and makes the same
/// deposit. The pool, the hook and the token are mainnet's; only USDC is substituted, because
/// Arc's real USDC calls a compliance precompile Foundry does not implement.
///
///   ARC_RPC_URL=https://rpc.mainnet.arc.io forge test --match-contract FirstDepositFork -vv
contract FirstDepositForkTest is Test {
    address constant ARC101 = 0xac61f15a9E41B62c484EFcC5DBd57044E1793A8f;
    address constant ARGUS_HOOK = 0x15d8EE821b82f2Cc067Ee2ab50a0eA826c812044;
    uint24 constant ARGUS_FEE = 10_000;
    int24 constant ARGUS_TICK_SPACING = 200;

    IPoolManager manager = IPoolManager(ArcChain.POOL_MANAGER);
    BlocklistERC20 usdc = BlocklistERC20(ArcChain.USDC_ERC20);

    VaultFactory factory;
    LiquidityVault vault;
    address staker = makeAddr("staker");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;

        deployCodeTo(
            "BlocklistERC20.sol:BlocklistERC20",
            abi.encode("USD Coin", "USDC", uint8(6)),
            ArcChain.USDC_ERC20
        );
        usdc.mint(ArcChain.POOL_MANAGER, 10_000_000e6);

        // The staker's real balance at the time, near enough: a couple of dollars.
        usdc.mint(staker, 2e6);

        VaultDeployer deployer = new VaultDeployer();
        factory = new VaultFactory(manager, deployer, address(this), address(this));
        deployer.setFactory(address(factory));

        vault = LiquidityVault(
            factory.createVault(
                PoolKey({
                    currency0: Currency.wrap(ArcChain.USDC_ERC20),
                    currency1: Currency.wrap(ARC101),
                    fee: ARGUS_FEE,
                    tickSpacing: ARGUS_TICK_SPACING,
                    hooks: IHooks(ARGUS_HOOK)
                })
            )
        );

        vm.prank(staker);
        usdc.approve(address(vault), type(uint256).max);
    }

    modifier onlyForked() {
        if (!forked) {
            console2.log("SKIPPED: set ARC_RPC_URL");
            return;
        }
        _;
    }

    /// @dev What the keeper has already done to every listed vault by the time anyone sees it.
    function _warmOracle() internal {
        for (uint256 i = 0; i < 34; i++) {
            vault.poke();
            vm.warp(block.timestamp + 90);
        }
    }

    /// @notice The floor the panel now sends is one the call actually clears.
    ///
    /// The old panel derived `minShares` from arithmetic that could not see the hook's cut, so on
    /// this pool it asked for roughly 95 bps more than the call returns while allowing 50. This
    /// reproduces the new sequence: quote the call with a zero floor, take the tolerance off that,
    /// then send it for real. If the quote is honest, the second call clears its own floor.
    function test_theQuotedFloorIsOneTheCallClears() public onlyForked {
        _warmOracle();

        uint256 snap = vm.snapshotState();
        vm.prank(staker);
        uint256 quoted = vault.depositUsdc(1e6, 0, staker);
        vm.revertToState(snap);

        uint256 floor50Bps = (quoted * 9_950) / 10_000;
        console2.log("quoted shares   ", quoted);
        console2.log("floor at 0.50%  ", floor50Bps);

        vm.prank(staker);
        uint256 actual = vault.depositUsdc(1e6, floor50Bps, staker);
        console2.log("actual shares   ", actual);
        assertGe(actual, floor50Bps, "the quoted floor rejected its own quote");

        // The floor the old panel sent, for reference: it showed 0.0001475 shares and insisted on
        // 0.0001468, against a call returning 0.0001461 at the time. Logged rather than asserted —
        // this fork tracks the live pool, so whether today's price happens to clear a floor from
        // last night says nothing about the code, and an assertion on it would fail on any day the
        // token went up.
        console2.log("the floor the old panel sent", uint256(146_800_000_000_000));
    }

    /// @notice One dollar, USDC-only, into an empty vault on the real ARC 101 pool.
    function test_theReportedDeposit() public onlyForked {
        _warmOracle();

        (bool warm, uint160 spot, uint160 twap) = vault.prices();
        uint256 dev = spot > twap
            ? (uint256(spot - twap) * 10_000) / twap
            : (uint256(twap - spot) * 10_000) / twap;
        console2.log("oracle warm     ", warm);
        console2.log("deviation (bps) ", dev);
        console2.log("band (bps)      ", vault.maxDeviationBps());
        console2.log("vault liquidity ", vault.totalLiquidity());
        assertTrue(warm, "oracle cold");
        assertEq(vault.totalLiquidity(), 0, "this must be the first deposit");

        uint256 before = usdc.balanceOf(staker);

        vm.prank(staker);
        uint256 shares = vault.depositUsdc(1e6, 0, staker);

        console2.log("usdc spent      ", before - usdc.balanceOf(staker));
        console2.log("shares minted   ", shares);
        assertGt(shares, 0, "the reported deposit still mints nothing");
        assertEq(vault.balanceOf(staker), shares, "shares not credited to the staker");

        // And they can get back out, through the same hook.
        vm.prank(staker);
        (uint256 a0, uint256 a1) = vault.withdraw(shares, 0, 0, staker);
        console2.log("usdc returned   ", a0);
        console2.log("arc101 returned ", a1);
        assertGt(a0 + a1, 0, "withdrawal returned nothing");
    }

    /// @notice Everything a staker and a keeper do, in order, on a vault that starts empty.
    ///
    /// Sequenced rather than split into separate tests because the bug that started this only
    /// existed in a sequence. No isolated test set up that state, because every other test seeded
    /// the vault before doing anything interesting to it.
    function test_fullLifecycleFromEmpty() public onlyForked {
        _warmOracle();

        // 1. First in, single-sided.
        vm.prank(staker);
        uint256 shares = vault.depositUsdc(1e6, 0, staker);
        assertGt(shares, 0, "first deposit");

        // 2. Somebody else follows, into a vault that now holds something.
        address second = makeAddr("second");
        usdc.mint(second, 5e6);
        vm.startPrank(second);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares2 = vault.depositUsdc(2e6, 0, second);
        vm.stopPrank();
        assertGt(shares2, 0, "second deposit");

        // 3. A keeper round: poke, harvest, compound whatever that queued.
        //
        // The oracle has to be allowed to catch up first. Both deposits swapped half their input,
        // which moved spot away from an average taken before they existed, and a fresh vault
        // starts with a 1% band — so compounding immediately is asking the vault to trade at a
        // price it has every reason to distrust, and it declines. In production nothing arrives
        // that fast: the keeper pokes every 60-90 seconds and the average absorbs the move long
        // before anyone calls compound. Warping reproduces that rather than working around it.
        _warmOracle();
        vault.harvest();

        // Compounding swaps, so it is subject to the same band as a single-sided deposit, and on a
        // pool this thin the vault's own harvest swap can be what pushes spot off the average.
        // Declining is a documented outcome, not a failure: the queue is left intact and the next
        // attempt takes it. Asserting that it must succeed would be asserting that this launchpad
        // pool is deep enough today, which is not a property of the code.
        if (vault.pendingCompound() > 0) {
            (, uint160 s, uint160 t) = vault.prices();
            uint256 dev = s > t ? (uint256(s - t) * 10_000) / t : (uint256(t - s) * 10_000) / t;
            console2.log("deviation before compound (bps)", dev);
            console2.log("band (bps)", vault.maxDeviationBps());
            console2.log("pendingCompound (usdc units)", vault.pendingCompound());

            uint256 queued = vault.pendingCompound();
            try vault.compound() returns (uint128 added) {
                console2.log("compounded, liquidity added", added);
            } catch (bytes memory err) {
                // Two legitimate declines. PriceOutOfBand means the pool is dislocated and the
                // vault will not trade into it. NothingToCompound means the queue is a single
                // unit, which cannot be halved — it used to report itself as PriceOutOfBand,
                // which is what sent this investigation looking at the oracle while the deviation
                // sat at 0 bps.
                bytes4 sel = bytes4(err);
                assertTrue(
                    sel == LiquidityVault.PriceOutOfBand.selector
                        || sel == LiquidityVault.NothingToCompound.selector,
                    "compound failed for a reason that is not one of its two legitimate declines"
                );
                assertEq(vault.pendingCompound(), queued, "a declined compound must keep the queue");
                console2.log("compound declined cleanly, queue intact");
                console2.logBytes4(sel);
            }
        }

        // 4. Claim whatever streamed.
        vm.warp(block.timestamp + 1 days);
        vm.prank(staker);
        uint256 claimed = vault.claim();
        console2.log("claimed after a day", claimed);

        // 5. Both leave. The last one out must not be trapped by the first one's exit.
        vm.prank(staker);
        (uint256 s0, uint256 s1) = vault.withdraw(shares, 0, 0, staker);
        vm.prank(second);
        (uint256 t0, uint256 t1) = vault.withdraw(shares2, 0, 0, second);
        console2.log("staker out (usdc, token)", s0, s1);
        console2.log("second out (usdc, token)", t0, t1);
        assertGt(s0 + s1, 0, "first staker got nothing back");
        assertGt(t0 + t1, 0, "last staker out got nothing back");

        // 6. And the vault still works afterwards, rather than being left in a state the next
        //    depositor cannot enter — which is exactly what went wrong the first time round.
        assertEq(vault.totalSupply(), vault.balanceOf(address(0xdead)), "only dead shares remain");
        _warmOracle(); // for the same reason as above: the exits moved the price too
        vm.prank(staker);
        uint256 again = vault.depositUsdc(5e5, 0, staker);
        assertGt(again, 0, "vault could not be re-entered after everyone left");
    }
}
