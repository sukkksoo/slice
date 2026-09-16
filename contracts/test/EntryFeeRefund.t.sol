// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultDeployer} from "../src/VaultDeployer.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {BlocklistERC20} from "./mocks/BlocklistERC20.sol";

/// @notice The entry fee must be charged on capital the vault actually deploys, never on the
///         portion handed straight back.
///
/// `deposit` takes *maximum* amounts and refunds whatever the position could not absorb, so
/// supplying generously on one side is the normal way to use it. If the fee is taken off the
/// gross pull, a depositor pays for money that never left their control.
contract EntryFeeRefundTest is Test {
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    address constant TOKEN_ADDR = 0x9000000000000000000000000000000000000001;

    IPoolManager manager;
    VaultFactory factory;
    LiquidityVault vault;
    BlocklistERC20 usdc;
    BlocklistERC20 token;
    PoolKey key;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        manager = IPoolManager(address(new PoolManager(owner)));
        deployCodeTo("BlocklistERC20.sol:BlocklistERC20", abi.encode("USD Coin", "USDC", uint8(6)), ArcChain.USDC_ERC20);
        usdc = BlocklistERC20(ArcChain.USDC_ERC20);
        deployCodeTo("BlocklistERC20.sol:BlocklistERC20", abi.encode("Arc Token", "ARCT", uint8(18)), TOKEN_ADDR);
        token = BlocklistERC20(TOKEN_ADDR);

        key = PoolKey({
            currency0: Currency.wrap(ArcChain.USDC_ERC20),
            currency1: Currency.wrap(TOKEN_ADDR),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        manager.initialize(key, uint160(1e6 * (uint256(1) << 96)));

        VaultDeployer deployer = new VaultDeployer();
        factory = new VaultFactory(manager, deployer, owner, treasury);
        deployer.setFactory(address(factory));
        vault = LiquidityVault(factory.createVault(key));

        for (uint256 i; i < 2; i++) {
            address who = i == 0 ? alice : bob;
            usdc.mint(who, 10_000_000e6);
            token.mint(who, 10_000_000e18);
            vm.startPrank(who);
            usdc.approve(address(vault), type(uint256).max);
            token.approve(address(vault), type(uint256).max);
            vm.stopPrank();
        }

        vm.prank(alice);
        vault.deposit(1_000_000e6, 1_000_000e18, 0, alice);
    }

    /// @notice A lopsided deposit must not be charged for the side that comes straight back.
    function test_entryFeeIsNotChargedOnTheRefundedPortion() public {
        uint256 usdcBefore = usdc.balanceOf(bob);
        uint256 tokenBefore = token.balanceOf(bob);
        uint256 feeBefore = vault.pendingDepositFees0();

        // Wildly over-supply USDC: the position can only absorb it at the pool's ratio, so the
        // overwhelming majority is refunded within the same call.
        vm.prank(bob);
        vault.deposit(1_000e6, 1e18, 0, bob);

        uint256 usdcSpent = usdcBefore - usdc.balanceOf(bob);
        uint256 tokenSpent = tokenBefore - token.balanceOf(bob);
        uint256 feeTaken = vault.pendingDepositFees0() - feeBefore;

        console2.log("usdc actually consumed (incl. fee) :", usdcSpent);
        console2.log("token actually consumed            :", tokenSpent);
        console2.log("entry fee charged in usdc          :", feeTaken);

        // The fee is 0.5%, so it can never exceed 0.5% of what the depositor actually parted with.
        uint256 maxDefensibleFee = (usdcSpent * vault.depositFeeBps()) / 10_000 + 1;
        console2.log("max defensible fee                 :", maxDefensibleFee);

        assertLe(feeTaken, maxDefensibleFee, "entry fee was charged on refunded capital");
    }

    /// @notice At any deposit ratio, the fee is at most the stated rate on capital actually parted with.
    /// @dev The bug this pins had no single trigger ratio — the overcharge scaled with how lopsided
    ///      the deposit was, so the property is fuzzed across the whole range rather than sampled.
    function testFuzz_entryFeeNeverExceedsRateOnDeployedCapital(uint256 usdcMax, uint256 tokenMax) public {
        usdcMax = bound(usdcMax, 1e6, 1_000_000e6);
        tokenMax = bound(tokenMax, 1e18, 1_000_000e18);

        uint256 usdcBefore = usdc.balanceOf(bob);
        uint256 tokenBefore = token.balanceOf(bob);
        uint256 fee0Before = vault.pendingDepositFees0();
        uint256 fee1Before = vault.pendingDepositFees1();

        vm.prank(bob);
        vault.deposit(usdcMax, tokenMax, 0, bob);

        uint256 usdcParted = usdcBefore - usdc.balanceOf(bob);
        uint256 tokenParted = tokenBefore - token.balanceOf(bob);
        uint16 bps = vault.depositFeeBps();

        // +1 absorbs the wei that integer division can leave on the protocol's side.
        assertLe(
            vault.pendingDepositFees0() - fee0Before,
            (usdcParted * bps) / 10_000 + 1,
            "usdc entry fee exceeded the stated rate"
        );
        assertLe(
            vault.pendingDepositFees1() - fee1Before,
            (tokenParted * bps) / 10_000 + 1,
            "token entry fee exceeded the stated rate"
        );
    }

    /// @notice Every USDC the vault says it owes somebody is actually sitting in the contract.
    ///
    /// @dev The vault keeps four separate claims on the same USDC balance — staker rewards, the
    ///      protocol's cut, the compounding queue and entry fees. Nothing enforces at the type
    ///      level that a withdrawal from one bucket cannot eat another's, so the sum is checked
    ///      against the real balance after exercising all of them.
    function test_everyTrackedUsdcClaimIsBacked() public {
        vm.prank(bob);
        vault.deposit(50_000e6, 50_000e18, 0, bob);

        vault.poke();
        vm.warp(block.timestamp + vault.MIN_TWAP_WINDOW() + 1);
        vault.poke();
        vault.harvest();

        uint256 owed = vault.reservedRewards() + vault.pendingProtocolFees() + vault.pendingCompound()
            + vault.pendingDepositFees0();
        assertGe(usdc.balanceOf(address(vault)), owed, "vault owes more USDC than it holds");

        // Draining each bucket in turn must not starve the others.
        vault.collectProtocolFees();
        vault.collectDepositFees();
        vm.prank(bob);
        vault.claim();

        uint256 owedAfter = vault.reservedRewards() + vault.pendingProtocolFees() + vault.pendingCompound()
            + vault.pendingDepositFees0();
        assertGe(usdc.balanceOf(address(vault)), owedAfter, "a collection ate another bucket's backing");
    }
}
