// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {BlocklistERC20} from "./mocks/BlocklistERC20.sol";

/// @notice The USDC-only deposit path, end to end, on the live ARC 101 vault.
///
/// This is the half of the product that cannot be demonstrated on mainnet without waiting for a
/// keeper to fill the oracle's ring — 32 observations, ~47 minutes — and then hoping the token
/// happens to be sitting near its own average at that moment. A fork can warp time instead, so
/// the mechanism gets tested rather than the weather.
///
/// The same USDC substitution as MainnetRoundTrip applies, and for the same reason: Arc's USDC
/// wraps precompiles Foundry does not implement. The vault, the pool and the Argus hook are real.
///
///   ARC_RPC_URL=https://rpc.mainnet.arc.io forge test --match-contract SingleSided -vv
contract SingleSidedTest is Test {
    LiquidityVault constant VAULT = LiquidityVault(0x23db9Eea0124a95Abd538BFc6BBe2add62be9a50);
    address constant ARC101 = 0xac61f15a9E41B62c484EFcC5DBd57044E1793A8f;

    BlocklistERC20 usdc = BlocklistERC20(ArcChain.USDC_ERC20);
    address staker = makeAddr("staker");
    address seeder = makeAddr("seeder");
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
        usdc.mint(staker, 10_000e6);
        usdc.mint(seeder, 10_000e6);
        deal(ARC101, seeder, 100_000_000e18);

        vm.startPrank(staker);
        usdc.approve(address(VAULT), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(seeder);
        usdc.approve(address(VAULT), type(uint256).max);
        IERC20Metadata(ARC101).approve(address(VAULT), type(uint256).max);
        vm.stopPrank();
    }

    modifier onlyForked() {
        if (!forked) {
            console2.log("SKIPPED: set ARC_RPC_URL");
            return;
        }
        _;
    }

    /// @dev Fill the oracle's ring the way a keeper does: 32 observations, spaced far enough apart
    ///      that the span clears MIN_TWAP_WINDOW. Time is warped rather than waited out, and the
    ///      price is left alone throughout, so what comes out is a genuine average of a steady
    ///      market — the condition the deviation band exists to insist on.
    function _warmOracle() internal {
        for (uint256 i = 0; i < 34; i++) {
            VAULT.poke();
            vm.warp(block.timestamp + 90);
        }
    }

    /// @notice A USDC-only deposit works once the oracle is warm and the price is steady.
    function test_usdcOnlyDepositWorksOnAWarmSteadyPool() public onlyForked {
        // Somebody has to be first, and the first deposit cannot swap — there is no average yet to
        // price it against. Two-sided needs no oracle, which is what makes the bootstrap possible.
        vm.prank(seeder);
        VAULT.deposit(1_000e6, 50_000_000e18, 0, seeder);

        (bool warmBefore,,) = VAULT.prices();
        console2.log("oracle warm before poking", warmBefore);

        _warmOracle();

        (bool warm, uint160 spot, uint160 twap) = VAULT.prices();
        uint256 dev = spot > twap
            ? (uint256(spot - twap) * 10_000) / twap
            : (uint256(twap - spot) * 10_000) / twap;
        console2.log("oracle warm", warm);
        console2.log("deviation (bps)", dev);
        console2.log("band (bps)", VAULT.maxDeviationBps());
        assertTrue(warm, "oracle did not warm");
        assertLe(dev, VAULT.maxDeviationBps(), "steady price should sit inside the band");

        uint256 before = usdc.balanceOf(staker);
        vm.prank(staker);
        uint256 shares = VAULT.depositUsdc(500e6, 0, staker);

        console2.log("usdc in    ", before - usdc.balanceOf(staker));
        console2.log("shares out ", shares);
        assertGt(shares, 0, "single-sided deposit minted nothing");
        assertEq(VAULT.balanceOf(staker), shares, "shares not credited");

        // And the staker can leave again.
        vm.prank(staker);
        (uint256 a0, uint256 a1) = VAULT.withdraw(shares, 0, 0, staker);
        console2.log("usdc back  ", a0);
        console2.log("token back ", a1);
        assertGt(a0 + a1, 0, "withdrawal returned nothing");
    }

    /// @notice The live CINU vault, whose price genuinely is dislocated, refuses the same call.
    function test_liveDislocatedPoolRefusesSingleSided() public onlyForked {
        LiquidityVault cinu = LiquidityVault(0x54F81A153B02255E714d97E07F4f2F9a75FFA1A1);

        (bool warm, uint160 spot, uint160 twap) = cinu.prices();
        if (!warm || twap == 0) {
            console2.log("CINU oracle is cold on this fork; nothing to assert");
            return;
        }
        uint256 dev = spot > twap
            ? (uint256(spot - twap) * 10_000) / twap
            : (uint256(twap - spot) * 10_000) / twap;
        console2.log("CINU deviation (bps)", dev);

        if (dev <= cinu.maxDeviationBps()) {
            console2.log("CINU happens to be inside its band right now; nothing to assert");
            return;
        }

        usdc.mint(staker, 1_000e6);
        vm.startPrank(staker);
        usdc.approve(address(cinu), type(uint256).max);
        vm.expectRevert(LiquidityVault.PriceOutOfBand.selector);
        cinu.depositUsdc(100e6, 0, staker);
        vm.stopPrank();
        console2.log("refused, as it should be");
    }
}
