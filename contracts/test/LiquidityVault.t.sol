// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {DeltaTestBase} from "./Base.t.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";

contract LiquidityVaultTest is DeltaTestBase {
    function test_firstDeposit_mintsSharesAndLocksMinimum() public {
        uint256 shares = _seed(alice, 100_000e6, 100_000e18);

        assertGt(shares, 0, "no shares minted");
        assertEq(vault.balanceOf(alice), shares, "shares not credited");
        assertEq(vault.balanceOf(address(0xdead)), 1_000, "minimum shares not burned");
        assertEq(vault.totalSupply(), shares + 1_000, "supply mismatch");
        assertEq(uint256(vault.totalLiquidity()), shares + 1_000, "liquidity should equal supply on first deposit");
    }

    function test_secondDeposit_sharesAreProportional() public {
        uint256 aliceShares = _seed(alice, 100_000e6, 100_000e18);
        uint256 bobShares = _seed(bob, 50_000e6, 50_000e18);

        // Bob put in half of Alice's size, so he should hold ~half her shares.
        assertApproxEqRel(bobShares, aliceShares / 2, 0.01e18, "shares not proportional to deposit");
    }

    function test_withdraw_returnsUnderlying() public {
        uint256 shares = _seed(alice, 100_000e6, 100_000e18);

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 tokenBefore = token.balanceOf(alice);

        vm.prank(alice);
        vault.withdraw(shares, 0, 0, alice);

        assertEq(vault.balanceOf(alice), 0, "shares not burned");
        assertGt(usdc.balanceOf(alice), usdcBefore, "no USDC returned");
        assertGt(token.balanceOf(alice), tokenBefore, "no token returned");
    }

    function test_depositWithdrawRoundTrip_doesNotCreateValue() public {
        _seed(bob, 1_000_000e6, 1_000_000e18);

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 tokenBefore = token.balanceOf(alice);

        uint256 shares = _seed(alice, 100_000e6, 100_000e18);
        vm.prank(alice);
        vault.withdraw(shares, 0, 0, alice);

        assertLe(usdc.balanceOf(alice), usdcBefore, "round trip minted USDC");
        assertLe(token.balanceOf(alice), tokenBefore, "round trip minted tokens");
    }

    function test_harvest_streamsRatherThanPayingInstantly() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _warmOracle();
        _generateFees(50_000e6, 50_000e18);

        vault.harvest();

        // Nothing is claimable the instant the harvest lands.
        assertEq(vault.earned(alice), 0, "fees paid out instantly");
        assertGt(vault.rewardRate(), 0, "stream never started");
        assertEq(vault.periodFinish(), block.timestamp + vault.STREAM_DURATION(), "wrong stream end");

        vm.warp(block.timestamp + 1 days);
        uint256 afterOneDay = vault.earned(alice);
        assertGt(afterOneDay, 0, "nothing accrued after a day");

        vm.warp(block.timestamp + 6 days);
        uint256 afterFullStream = vault.earned(alice);
        assertApproxEqRel(afterFullStream, afterOneDay * 7, 0.02e18, "stream is not linear");
    }

    function test_claim_transfersStreamedUsdc() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _warmOracle();
        _generateFees(50_000e6, 50_000e18);
        vault.harvest();

        vm.warp(block.timestamp + vault.STREAM_DURATION());

        uint256 expected = vault.earned(alice);
        assertGt(expected, 0, "nothing to claim");

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 claimed = vault.claim();

        assertEq(claimed, expected, "claimed amount differs from earned");
        assertEq(usdc.balanceOf(alice) - before, claimed, "USDC not transferred");
        assertEq(vault.earned(alice), 0, "still owed after claiming");
    }

    /// @notice The core reason fees are streamed: a depositor who arrives after the fees were
    ///         earned must not be able to capture them.
    function test_lateDepositor_cannotSnipeAccruedFees() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _warmOracle();
        _generateFees(100_000e6, 100_000e18);

        // Roughly 300 USDC and 300 tokens of fees are now sitting on the position, unharvested.
        // Bob arrives only once the trading is done, then leaves immediately.
        uint256 usdcBefore = usdc.balanceOf(bob);
        uint256 tokenBefore = token.balanceOf(bob);

        uint256 bobShares = _seed(bob, 1_000_000e6, 1_000_000e18);
        vm.startPrank(bob);
        vault.withdraw(bobShares, 0, 0, bob);
        uint256 claimed = vault.claim();
        vm.stopPrank();

        assertEq(claimed, 0, "in-and-out depositor claimed streamed fees");

        // Value is the sharper test: it catches fees captured through the settlement path rather
        // than the reward stream. An uncollected fee left on the position when Bob deposits would
        // net against what he owes and surface here as a profitable round trip. Both snapshots
        // are priced at the *current* tick so the comparison is not distorted by the price having
        // moved while he was an LP.
        uint256 valueBefore = _valueInUsdc(usdcBefore, tokenBefore);
        uint256 valueAfter = _valueInUsdc(usdc.balanceOf(bob), token.balanceOf(bob));
        uint256 extracted = valueAfter > valueBefore ? valueAfter - valueBefore : 0;

        // ~600 USDC of fees were on the table. Bob may keep only his pro-rata share of the single
        // swap the harvest runs while he happens to be staked, which is earned, not sniped.
        assertLt(extracted, 1e6, "in-and-out depositor captured pending fees");

        // And the fees earned before Bob showed up still belong to Alice.
        vm.warp(block.timestamp + vault.STREAM_DURATION());
        assertGt(vault.earned(alice), 0, "pre-existing staker lost the fee stream");
    }

    /// @notice Depositing must not sweep the position's pending fees into the depositor's
    ///         settlement. The vault harvests first specifically to prevent this.
    function test_depositHarvestsFirst_soPendingFeesStayWithStakers() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _warmOracle();
        _generateFees(100_000e6, 100_000e18);

        uint256 rewardRateBefore = vault.rewardRate();
        assertEq(rewardRateBefore, 0, "stream started too early");

        _seed(bob, 10_000e6, 10_000e18);

        assertGt(vault.rewardRate(), 0, "deposit did not trigger a harvest");
    }

    function test_compound_raisesNavWithoutMintingShares() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _warmOracle();

        // Route the whole harvest into the compounding queue rather than the stream.
        vm.prank(owner);
        vault.setParameters(100, 0, 100);

        _generateFees(50_000e6, 50_000e18);
        vault.harvest();
        assertGt(vault.pendingCompound(), 0, "nothing queued for compounding");

        uint256 supplyBefore = vault.totalSupply();
        uint256 liquidityBefore = vault.totalLiquidity();
        (uint256 amount0Before,) = vault.previewRedeem(vault.balanceOf(alice));

        vault.compound();

        assertEq(vault.totalSupply(), supplyBefore, "compounding minted shares");
        assertGt(vault.totalLiquidity(), liquidityBefore, "compounding added no liquidity");

        (uint256 amount0After,) = vault.previewRedeem(vault.balanceOf(alice));
        assertGt(amount0After, amount0Before, "NAV per share did not rise");
    }

    /// @notice A cold oracle must defer the asset-side swap, not revert: harvest sits on the
    ///         deposit and withdraw paths and bricking it would freeze the vault.
    function test_coldOracle_defersAssetFeesInsteadOfReverting() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _generateFees(50_000e6, 50_000e18); // no _warmOracle()

        vault.harvest();

        uint256 deferred = vault.pendingAssetFees();
        assertGt(deferred, 0, "asset fees were not deferred");

        // Once the oracle is warm the deferred balance is swapped and distributed. A small
        // residue remains by construction: converting the fees is itself a swap, and the vault's
        // own position earns the LP fee on it. That residue is ~0.3% of the amount converted and
        // is carried into the next harvest, not lost.
        _warmOracle();
        vault.harvest();

        assertLt(vault.pendingAssetFees(), deferred / 100, "deferred fees were not converted");
        assertGt(vault.rewardRate(), 0, "deferred fees never reached the stream");
    }

    function test_withdrawStillWorksWhileOracleIsCold() public {
        uint256 shares = _seed(alice, 1_000_000e6, 1_000_000e18);
        _generateFees(50_000e6, 50_000e18);

        vm.prank(alice);
        (uint256 amount0, uint256 amount1) = vault.withdraw(shares, 0, 0, alice);

        assertGt(amount0, 0, "withdraw returned nothing for currency0");
        assertGt(amount1, 0, "withdraw returned nothing for currency1");
    }

    function test_depositUsdc_singleSidedEntry() public {
        _seed(bob, 1_000_000e6, 1_000_000e18);
        _warmOracle();

        uint256 tokenBefore = token.balanceOf(alice);

        vm.prank(alice);
        uint256 shares = vault.depositUsdc(100_000e6, 0, alice);

        assertGt(shares, 0, "no shares from single-sided deposit");
        assertEq(vault.balanceOf(alice), shares, "shares not credited");
        assertGe(token.balanceOf(alice), tokenBefore, "single-sided deposit consumed the caller's tokens");
    }

    function test_depositUsdc_revertsWhileOracleIsCold() public {
        _seed(bob, 1_000_000e6, 1_000_000e18);

        vm.prank(alice);
        vm.expectRevert(LiquidityVault.PriceOutOfBand.selector);
        vault.depositUsdc(100_000e6, 0, alice);
    }

    /// @notice Protocol fees accrue on harvest and are collected separately.
    /// @dev Pull, not push. Arc's USDC reverts for a blocklisted party, and `harvest` sits on the
    ///      deposit and withdraw paths — so pushing to the treasury here would let a third party
    ///      freeze the vault by blocklisting one address. See ProtocolFees.t.sol.
    function test_protocolFee_accruesThenCollects() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _warmOracle();
        _generateFees(50_000e6, 50_000e18);

        uint256 before = usdc.balanceOf(treasury);
        vault.harvest();

        uint256 accrued = vault.pendingProtocolFees();
        assertGt(accrued, 0, "no protocol fee accrued");
        assertEq(usdc.balanceOf(treasury), before, "harvest pushed funds to the treasury");

        assertEq(vault.collectProtocolFees(), accrued, "collection paid a different amount");
        assertEq(usdc.balanceOf(treasury) - before, accrued, "treasury not paid on collection");
        assertEq(vault.pendingProtocolFees(), 0, "accrual not cleared");
    }

    function test_rewardsFollowShareTransfers() public {
        _seed(alice, 1_000_000e6, 1_000_000e18);
        _warmOracle();
        _generateFees(50_000e6, 50_000e18);
        vault.harvest();

        vm.warp(block.timestamp + 1 days);
        uint256 aliceEarnedAtTransfer = vault.earned(alice);
        uint256 aliceShares = vault.balanceOf(alice);

        vm.prank(alice);
        vault.transfer(bob, aliceShares);

        // Alice keeps what she accrued while holding; Bob starts from zero.
        assertApproxEqAbs(vault.earned(alice), aliceEarnedAtTransfer, 1, "transfer erased accrued rewards");
        assertEq(vault.earned(bob), 0, "recipient inherited accrued rewards");

        vm.warp(block.timestamp + 1 days);
        assertGt(vault.earned(bob), 0, "recipient accrues nothing after transfer");
    }

    function test_setParameters_rejectsOutOfRangeValues() public {
        vm.startPrank(owner);

        vm.expectRevert(LiquidityVault.ParameterOutOfRange.selector);
        vault.setParameters(1_001, 10_000, 100); // protocol fee above 10%

        vm.expectRevert(LiquidityVault.ParameterOutOfRange.selector);
        vault.setParameters(100, 10_001, 100); // stream share above 100%

        vm.expectRevert(LiquidityVault.ParameterOutOfRange.selector);
        vault.setParameters(100, 10_000, 501); // deviation band above 5%

        vm.expectRevert(LiquidityVault.ParameterOutOfRange.selector);
        vault.setParameters(100, 10_000, 0); // deviation band of zero

        vm.stopPrank();
    }

    function test_setParameters_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(LiquidityVault.NotOwner.selector);
        vault.setParameters(100, 10_000, 100);
    }

    function test_unlockCallback_rejectsForeignCallers() public {
        vm.prank(alice);
        vm.expectRevert(LiquidityVault.NotPoolManager.selector);
        vault.unlockCallback("");
    }

    function testFuzz_depositWithdraw_neverReturnsMoreThanDeposited(uint256 usdcAmount, uint256 tokenAmount)
        public
    {
        usdcAmount = bound(usdcAmount, 1e6, 1_000_000e6);
        tokenAmount = bound(tokenAmount, 1e18, 1_000_000e18);

        _seed(bob, 1_000_000e6, 1_000_000e18);

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 tokenBefore = token.balanceOf(alice);

        uint256 shares = _seed(alice, usdcAmount, tokenAmount);
        vm.assume(shares > 0);

        vm.prank(alice);
        vault.withdraw(shares, 0, 0, alice);

        assertLe(usdc.balanceOf(alice), usdcBefore, "withdrew more USDC than deposited");
        assertLe(token.balanceOf(alice), tokenBefore, "withdrew more tokens than deposited");
    }
}

/// @notice The whole suite again with the asset sorted as currency0, since half the branches in
///         the vault key off `usdcIsCurrency0`.
contract LiquidityVaultTokenFirstTest is LiquidityVaultTest {
    function tokenAddress() internal pure override returns (address) {
        return TOKEN_LOW;
    }
}
