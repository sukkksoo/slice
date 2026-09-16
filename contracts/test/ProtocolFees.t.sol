// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultDeployer} from "../src/VaultDeployer.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {BlocklistERC20} from "./mocks/BlocklistERC20.sol";

/// @notice Protocol fees must never be able to freeze the vault.
///
/// Arc's USDC reverts for a blocklisted party, and Circle — not the protocol, not the user —
/// decides who that is. Because `harvest` runs at the top of deposit, withdraw and compound,
/// anything on its path that a third party can make revert is a total-freeze vector for user
/// funds. These tests pin the pull-based design that removes it.
contract ProtocolFeesTest is Test {
    using PoolIdLibrary for PoolKey;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    address constant TOKEN_ADDR = 0x9000000000000000000000000000000000000001;

    IPoolManager manager;
    PoolSwapTest swapRouter;
    VaultFactory factory;
    LiquidityVault vault;
    BlocklistERC20 usdc;
    BlocklistERC20 token;
    PoolKey key;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");

    function setUp() public {
        manager = IPoolManager(address(new PoolManager(owner)));
        swapRouter = new PoolSwapTest(manager);

        deployCodeTo(
            "BlocklistERC20.sol:BlocklistERC20",
            abi.encode("USD Coin", "USDC", uint8(6)),
            ArcChain.USDC_ERC20
        );
        usdc = BlocklistERC20(ArcChain.USDC_ERC20);

        deployCodeTo(
            "BlocklistERC20.sol:BlocklistERC20", abi.encode("Arc Token", "ARCT", uint8(18)), TOKEN_ADDR
        );
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

        usdc.mint(alice, 10_000_000e6);
        token.mint(alice, 10_000_000e18);
        usdc.mint(address(this), 10_000_000e6);
        token.mint(address(this), 10_000_000e18);

        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        usdc.approve(address(swapRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        vm.prank(alice);
        vault.deposit(1_000_000e6, 1_000_000e18, 0, alice);

        vault.poke();
        vm.warp(block.timestamp + vault.MIN_TWAP_WINDOW() + 1);
        vault.poke();

        _swap(true, 50_000e6);
        _swap(false, 50_000e18);
    }

    function test_protocolFeesAccrueRatherThanBeingPushed() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vault.harvest();

        assertGt(vault.pendingProtocolFees(), 0, "protocol fee did not accrue");
        assertEq(usdc.balanceOf(treasury), treasuryBefore, "harvest pushed funds to the treasury");

        uint256 pending = vault.pendingProtocolFees();
        uint256 collected = vault.collectProtocolFees();

        assertEq(collected, pending, "collection paid a different amount than accrued");
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, pending, "treasury was not paid");
        assertEq(vault.pendingProtocolFees(), 0, "accrual not cleared after collection");
    }

    /// @notice The freeze vector. A blocklisted treasury must not take the vault down with it.
    function test_blocklistedTreasuryCannotFreezeTheVault() public {
        // Route half the harvest to the compounding queue so `compound()` has real work to do.
        vm.prank(owner);
        vault.setParameters(100, 5_000, 100);

        usdc.setBlocked(treasury, true);

        // Harvest still succeeds and still books the protocol's share.
        vault.harvest();
        assertGt(vault.pendingProtocolFees(), 0, "harvest did not accrue while treasury was blocked");

        // Only the treasury's own collection fails.
        vm.expectRevert(abi.encodeWithSelector(BlocklistERC20.Blocklisted.selector, treasury));
        vault.collectProtocolFees();

        // Everything users depend on keeps working.
        vm.startPrank(alice);
        uint256 shares = vault.deposit(1_000e6, 1_000e18, 0, alice);
        assertGt(shares, 0, "deposit blocked by a blocklisted treasury");

        (uint256 out0, uint256 out1) = vault.withdraw(shares, 0, 0, alice);
        assertGt(out0 + out1, 0, "withdraw blocked by a blocklisted treasury");
        vm.stopPrank();

        vault.compound();

        // And once the treasury is unblocked, the accrual is still there to collect.
        usdc.setBlocked(treasury, false);
        assertGt(vault.collectProtocolFees(), 0, "accrued fees lost while the treasury was blocked");
    }

    /// @notice A blocklisted staker is their own problem, never anyone else's.
    function test_blocklistedStakerCannotFreezeOtherStakers() public {
        vault.harvest();
        vm.warp(block.timestamp + vault.STREAM_DURATION());

        usdc.setBlocked(alice, true);

        // Alice cannot pull her own rewards out...
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BlocklistERC20.Blocklisted.selector, alice));
        vault.claim();

        // ...but the vault itself is unaffected.
        vault.harvest();
        assertGt(vault.collectProtocolFees(), 0, "vault operations blocked by a blocklisted staker");
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
