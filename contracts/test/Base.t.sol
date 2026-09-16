// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultDeployer} from "../src/VaultDeployer.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";

/// @notice Shared Arc-shaped fixture: a real v4 PoolManager, USDC etched at its canonical Arc
///         address, and a token/USDC pool with a vault on top.
abstract contract SliceTestBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev Deliberately above Arc's USDC address so that USDC sorts as currency0, which is the
    ///      common case on Arc. `TokenIsCurrency0Test` re-runs the suite with the ordering flipped.
    address internal constant TOKEN_HIGH = 0x9000000000000000000000000000000000000001;
    /// @dev Below Arc's USDC address, making the asset currency0.
    address internal constant TOKEN_LOW = 0x0000000000000000000000000000000000000111;

    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    IPoolManager internal manager;
    PoolSwapTest internal swapRouter;
    VaultFactory internal factory;
    LiquidityVault internal vault;

    MockERC20 internal usdc;
    MockERC20 internal token;
    PoolKey internal key;
    PoolId internal poolId;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    /// @notice Override to place the asset below USDC and flip currency ordering.
    function tokenAddress() internal view virtual returns (address) {
        return TOKEN_HIGH;
    }

    function setUp() public virtual {
        manager = IPoolManager(address(new PoolManager(owner)));
        swapRouter = new PoolSwapTest(manager);

        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("USD Coin", "USDC", uint8(6)), ArcChain.USDC_ERC20);
        usdc = MockERC20(ArcChain.USDC_ERC20);

        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("Arc Token", "ARCT", uint8(18)), tokenAddress());
        token = MockERC20(tokenAddress());

        bool usdcFirst = ArcChain.USDC_ERC20 < tokenAddress();
        key = PoolKey({
            currency0: Currency.wrap(usdcFirst ? ArcChain.USDC_ERC20 : tokenAddress()),
            currency1: Currency.wrap(usdcFirst ? tokenAddress() : ArcChain.USDC_ERC20),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        poolId = key.toId();

        // Start at 1 token (1e18 raw) == 1 USDC (1e6 raw). Uniswap prices raw against raw, so the
        // ratio is 1e12 in one direction and 1e-12 in the other.
        manager.initialize(key, _startingSqrtPrice(usdcFirst));

        VaultDeployer deployer = new VaultDeployer();
        factory = new VaultFactory(manager, deployer, owner, treasury);
        deployer.setFactory(address(factory));
        vault = LiquidityVault(factory.createVault(key));

        _fund(alice);
        _fund(bob);
        _fund(address(this));
    }

    /// @dev sqrt(1e12) * 2^96 when USDC is currency0, else sqrt(1e-12) * 2^96.
    function _startingSqrtPrice(bool usdcFirst) internal pure returns (uint160) {
        return usdcFirst ? uint160(1e6 * (uint256(1) << 96)) : uint160((uint256(1) << 96) / 1e6);
    }

    function _fund(address who) internal {
        usdc.mint(who, 10_000_000e6);
        token.mint(who, 10_000_000e18);

        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        token.approve(address(vault), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    /// @notice Seed the vault with `usdcAmount` / `tokenAmount` of liquidity from `who`.
    function _seed(address who, uint256 usdcAmount, uint256 tokenAmount) internal returns (uint256 shares) {
        (uint256 amount0, uint256 amount1) =
            vault.usdcIsCurrency0() ? (usdcAmount, tokenAmount) : (tokenAmount, usdcAmount);
        vm.prank(who);
        shares = vault.deposit(amount0, amount1, 0, who);
    }

    /// @notice Bring the vault's oracle past MIN_TWAP_WINDOW so automated swaps are permitted.
    function _warmOracle() internal {
        vault.poke();
        vm.warp(block.timestamp + vault.MIN_TWAP_WINDOW() + 1);
        vault.poke();
    }

    /// @notice Trade against the pool to generate swap fees for the vault's position.
    function _generateFees(uint256 usdcIn, uint256 tokenIn) internal {
        bool usdcIsZero = vault.usdcIsCurrency0();

        vm.startPrank(address(this));
        if (usdcIn > 0) _swap(usdcIsZero, usdcIn);
        if (tokenIn > 0) _swap(!usdcIsZero, tokenIn);
        vm.stopPrank();
    }

    /// @notice Value a (USDC, token) pair in USDC at the pool's current price.
    /// @dev Balance-by-balance assertions are the wrong tool once the vault swaps on its own pool:
    ///      any price move rebalances an LP between the two sides, so a staker can end up holding
    ///      more of one token and less of the other without having gained anything. Value is the
    ///      quantity that must not increase.
    function _valueInUsdc(uint256 usdcAmount, uint256 tokenAmount) internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(poolId);
        uint256 q96 = uint256(1) << 96;

        uint256 tokenValue = vault.usdcIsCurrency0()
            // USDC is currency0, so the pool price is token-per-USDC; invert it.
            ? FullMath.mulDiv(FullMath.mulDiv(tokenAmount, q96, sqrtPriceX96), q96, sqrtPriceX96)
            // Token is currency0, so the pool price is already USDC-per-token.
            : FullMath.mulDiv(FullMath.mulDiv(tokenAmount, sqrtPriceX96, q96), sqrtPriceX96, q96);

        return usdcAmount + tokenValue;
    }

    function _valueOf(address who) internal view returns (uint256) {
        return _valueInUsdc(usdc.balanceOf(who), token.balanceOf(who));
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
