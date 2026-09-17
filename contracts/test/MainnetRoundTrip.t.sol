// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {BlocklistERC20} from "./mocks/BlocklistERC20.sol";

/// @notice A deposit and withdrawal through the live CINU vault, against forked Arc mainnet.
///
/// WHY THIS IS A FORK TEST WITH A SUBSTITUTED USDC
///
/// Arc's USDC is a thin wrapper over two chain precompiles, and neither exists in Foundry's EVM,
/// so any call that moves USDC dies in a fork. Every earlier end-to-end test therefore ran on
/// testnet against a pool with no hook — which left the combination that actually matters, the
/// real Argus hook on a real deposit, completely unexercised.
///
/// The Argus hook's bytecode references the USDC address and neither precompile, so it reaches
/// USDC through the ordinary ERC-20 interface. Substituting a plain ERC-20 at that address
/// therefore leaves the hook's own logic intact: what runs here is the live vault, the live pool's
/// tick and liquidity state, and the live hook, with only the token underneath swapped out.
///
/// What this does NOT cover: Arc's real USDC semantics, above all the compliance check that
/// reverts for a blocklisted party. `ProtocolFees.t.sol` covers that separately.
///
///   ARC_RPC_URL=https://rpc.mainnet.arc.io forge test --match-contract MainnetRoundTrip -vv
contract MainnetRoundTripTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev The vault deployed on 2026-09-16, on an Argus CINU/USDC pool.
    LiquidityVault constant VAULT = LiquidityVault(0x4E6026d7E5eA91Be62Df463D65054157C0373634);
    address constant CINU = 0xBDBB76DB770cC99DCF3FA31C42C171b9584D6a10;

    IPoolManager manager = IPoolManager(ArcChain.POOL_MANAGER);
    BlocklistERC20 usdc = BlocklistERC20(ArcChain.USDC_ERC20);

    address staker = makeAddr("staker");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;

        // Swap a plain ERC-20 in at the USDC address. The pool's own reserves live in the
        // PoolManager's balance of that token, so it has to be re-credited: the substitution
        // replaces the accounting, and a pool the manager cannot pay out of would fail for
        // reasons that have nothing to do with the vault.
        uint256 managerHeld = 10_000_000e6;
        deployCodeTo(
            "BlocklistERC20.sol:BlocklistERC20",
            abi.encode("USD Coin", "USDC", uint8(6)),
            ArcChain.USDC_ERC20
        );
        usdc.mint(ArcChain.POOL_MANAGER, managerHeld);
        usdc.mint(staker, 1_000e6);

        // CINU is an ordinary ERC-20 and needs no substitution.
        deal(CINU, staker, 1_000_000e18);

        vm.startPrank(staker);
        usdc.approve(address(VAULT), type(uint256).max);
        IERC20Metadata(CINU).approve(address(VAULT), type(uint256).max);
        vm.stopPrank();
    }

    modifier onlyForked() {
        if (!forked) {
            console2.log("SKIPPED: set ARC_RPC_URL to run the mainnet round trip");
            return;
        }
        _;
    }

    /// @notice Two-sided deposit, then withdraw the lot, through the live hook.
    /// @dev Two-sided because it performs no swap, which is the path available whatever the price
    ///      is doing — and the one a staker can always rely on.
    function test_depositAndWithdrawThroughTheLiveArgusHook() public onlyForked {
        uint256 usdcBefore = usdc.balanceOf(staker);
        uint256 cinuBefore = IERC20Metadata(CINU).balanceOf(staker);

        vm.prank(staker);
        uint256 shares = VAULT.deposit(100e6, 500_000e18, 0, staker);

        assertGt(shares, 0, "no shares minted");
        console2.log("shares minted      ", shares);
        console2.log("usdc spent         ", usdcBefore - usdc.balanceOf(staker));
        console2.log("cinu spent         ", cinuBefore - IERC20Metadata(CINU).balanceOf(staker));

        // The entry fee is taken from what is actually deployed, and accrues rather than being
        // pushed, so it should be sitting in the vault waiting for collection.
        console2.log("entry fee usdc     ", VAULT.pendingDepositFees0());
        console2.log("entry fee cinu     ", VAULT.pendingDepositFees1());

        assertEq(VAULT.balanceOf(staker), shares, "shares not credited to the staker");

        // Now leave, which is the property that matters most: the hook must not be able to block
        // or skim an exit.
        vm.prank(staker);
        (uint256 out0, uint256 out1) = VAULT.withdraw(shares, 0, 0, staker);

        console2.log("usdc returned      ", out0);
        console2.log("cinu returned      ", out1);

        assertGt(out0 + out1, 0, "withdrawal returned nothing");
        assertEq(VAULT.balanceOf(staker), 0, "shares not burned");

        // A round trip must never hand back more than went in: that would mean the vault paid the
        // staker out of somebody else's position.
        assertLe(usdc.balanceOf(staker), usdcBefore, "returned more USDC than was deposited");
        assertLe(
            IERC20Metadata(CINU).balanceOf(staker), cinuBefore, "returned more CINU than deposited"
        );

        uint256 usdcKept = usdcBefore - usdc.balanceOf(staker);
        uint256 cinuKept = cinuBefore - IERC20Metadata(CINU).balanceOf(staker);
        console2.log("usdc retained by vault (fee + rounding)", usdcKept);
        console2.log("cinu retained by vault (fee + rounding)", cinuKept);
    }

    /// @notice Harvesting on the live pool, where the hook taxes every swap.
    function test_harvestSurvivesTheHookTax() public onlyForked {
        vm.prank(staker);
        VAULT.deposit(100e6, 500_000e18, 0, staker);

        // Harvest sits at the top of deposit and withdraw, so it must never revert, warm or not.
        VAULT.harvest();
        console2.log("pendingCompound    ", VAULT.pendingCompound());
        console2.log("pendingAssetFees   ", VAULT.pendingAssetFees());
        console2.log("pendingProtocolFees", VAULT.pendingProtocolFees());

        // And the exit still works afterwards.
        uint256 shares = VAULT.balanceOf(staker);
        vm.prank(staker);
        VAULT.withdraw(shares, 0, 0, staker);
        assertEq(VAULT.balanceOf(staker), 0, "could not exit after a harvest");
    }

    /// @notice The entry fee reaches the configured recipient and nobody else.
    function test_entryFeeReachesTheFeeRecipient() public onlyForked {
        address recipient = VAULT.feeRecipient();
        uint256 before = usdc.balanceOf(recipient);

        vm.prank(staker);
        VAULT.deposit(100e6, 500_000e18, 0, staker);

        uint256 accrued = VAULT.pendingDepositFees0();
        assertGt(accrued, 0, "no entry fee accrued");
        assertEq(usdc.balanceOf(recipient), before, "fee was pushed rather than accrued");

        // Permissionless: anyone may push the collection, and the destination is fixed.
        vm.prank(makeAddr("stranger"));
        VAULT.collectDepositFees();

        assertEq(usdc.balanceOf(recipient), before + accrued, "fee did not reach the recipient");
        console2.log("entry fee delivered to", recipient);
        console2.log("amount (usdc, 6dp)    ", accrued);
    }
}
