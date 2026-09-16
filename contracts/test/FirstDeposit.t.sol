// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {SliceTestBase} from "./Base.t.sol";

/// @notice The very first deposit into a vault, which is the one path nothing else covers.
///
/// Every other test in this suite reaches a warm vault by seeding it two-sided first, because that
/// is the convenient way to get liquidity in place. That convenience is precisely what hid this:
/// the seed puts liquidity in the vault's position, and from then on nothing ever asks v4 to touch
/// an empty one. A real user does the opposite — they find a listed pool, the keeper has been
/// poking it so the oracle is warm, and they deposit USDC.
///
/// The pool here therefore carries liquidity that is *not* the vault's, which is the real shape of
/// things: the token's own market exists, and the vault's position within it starts at nothing.
contract FirstDepositTest is SliceTestBase {
    PoolModifyLiquidityTest internal lpRouter;

    function setUp() public override {
        super.setUp();

        // Outside liquidity, so the pool can be traded against while the vault holds nothing.
        lpRouter = new PoolModifyLiquidityTest(manager);
        vm.startPrank(address(this));
        usdc.approve(address(lpRouter), type(uint256).max);
        token.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(TICK_SPACING),
                tickUpper: TickMath.maxUsableTick(TICK_SPACING),
                liquidityDelta: 1e15,
                salt: 0
            }),
            ""
        );
        vm.stopPrank();
    }

    /// @notice A USDC-only deposit into an empty vault: exactly what a user does first.
    function test_firstDepositCanBeUsdcOnly() public {
        _warmOracle();

        (bool warm,,) = vault.prices();
        assertTrue(warm, "oracle should be warm; the keeper pokes empty vaults too");
        assertEq(vault.totalLiquidity(), 0, "vault should still hold nothing");

        vm.prank(alice);
        uint256 shares = vault.depositUsdc(1_000e6, 0, alice);

        console2.log("shares from the first USDC-only deposit", shares);
        assertGt(shares, 0, "first single-sided deposit minted nothing");
        assertGt(vault.totalLiquidity(), 0, "vault took no liquidity");
    }

    /// @notice One dollar, the amount actually attempted, rather than a round test number.
    function test_firstDepositOfOneDollar() public {
        _warmOracle();

        vm.prank(alice);
        uint256 shares = vault.depositUsdc(1e6, 0, alice);
        assertGt(shares, 0, "a one dollar first deposit minted nothing");
    }

    /// @notice A vault cannot be emptied back to nothing once anyone has deposited.
    ///
    /// This is what bounds the bug above to the first deposit alone. MINIMUM_SHARES is minted to a
    /// dead address on the first deposit and can never be withdrawn, so the position keeps a floor
    /// of liquidity for the rest of its life and the harvest and compound paths never meet an
    /// empty one. Asserted rather than assumed, because the guard in `_collectFees` is only
    /// narrow if this holds.
    function test_vaultNeverEmptiesAgainAfterTheFirstDeposit() public {
        _warmOracle();
        uint256 shares = _seed(alice, 1_000e6, 1_000e18);
        _generateFees(500e6, 500e18);

        vault.harvest();
        vm.prank(alice);
        vault.withdraw(shares, 0, 0, alice);

        console2.log("liquidity left after the last staker exits", vault.totalLiquidity());
        assertEq(
            vault.totalSupply(),
            vault.balanceOf(address(0xdead)),
            "only the unwithdrawable dead shares should remain"
        );
        assertGt(vault.totalLiquidity(), 0, "the position must never empty once opened");

        // And the keeper's maintenance still runs against that floor rather than reverting on a
        // v4 internal it could not interpret.
        vault.harvest();
        if (vault.pendingCompound() > 0) vault.compound();
    }
}
