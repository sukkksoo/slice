// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {TestToken} from "./mocks/TestToken.sol";

/// @notice End-to-end smoke test against a live Arc testnet deployment.
///
/// Stands up a token, a USDC pool, and a vault; stakes into it; trades through the pool to generate
/// real swap fees; then harvests. Proves the protocol works against the actual Arc PoolManager
/// rather than a local fixture.
///
/// Time cannot be warped on a live chain, so the vault's 30-minute TWAP window will still be cold
/// here. That is deliberately part of what this exercises: harvest must degrade gracefully and
/// defer the token-side conversion instead of reverting, because it sits on the deposit and
/// withdraw paths. Run `HarvestTestnet` after 30+ minutes of pokes to watch the deferred fees
/// convert and reach the reward stream.
///
///   forge script script/SeedTestnet.s.sol --rpc-url $ARC_TESTNET_RPC_URL --broadcast
///
/// @dev State variables rather than locals throughout: the whole flow in one function overflows
///      the stack, and via_ir would slow every other build in the repo to fix one script.
contract SeedTestnet is Script {
    using PoolIdLibrary for PoolKey;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    /// @dev Kept small: the faucet hands out a limited USDC balance and gas comes from the same
    ///      pot. 2 USDC of depth is ample to move the fee accounting.
    uint256 constant USDC_LIQUIDITY = 2e6;
    uint256 constant TOKEN_LIQUIDITY = 2e18;
    uint256 constant SWAP_SIZE_USDC = 5e5;
    uint256 constant SWAP_SIZE_TOKEN = 5e17;

    IPoolManager manager = IPoolManager(ArcChain.POOL_MANAGER);
    IERC20 usdc = IERC20(ArcChain.USDC_ERC20);

    TestToken token;
    PoolSwapTest swapRouter;
    LiquidityVault vault;
    PoolKey key;
    bool usdcFirst;

    error WrongChain(uint256 actual);
    error InsufficientUsdc(uint256 have, uint256 need);

    function run() external {
        if (block.chainid != ArcChain.TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        VaultFactory factory = VaultFactory(vm.envAddress("DELTA_FACTORY"));
        uint256 balance = usdc.balanceOf(msg.sender);

        console2.log("deployer         ", msg.sender);
        console2.log("usdc balance     ", balance);
        if (balance < USDC_LIQUIDITY) revert InsufficientUsdc(balance, USDC_LIQUIDITY);

        vm.startBroadcast();
        _deployFixtures();
        _createPoolAndVault(factory);
        _stake();
        _trade();
        _harvest();
        vm.stopBroadcast();

        _report();
    }

    function _deployFixtures() internal {
        token = new TestToken("Delta Test Token", "DTT");
        token.mint(msg.sender, 1_000e18);
        console2.log("TestToken        ", address(token));

        // PoolSwapTest is a v4 test helper. Deploying it here is what lets this script trade
        // through the pool to generate fees; the canonical UniversalRouter is not on testnet.
        swapRouter = new PoolSwapTest(manager);
        console2.log("PoolSwapTest     ", address(swapRouter));
    }

    function _createPoolAndVault(VaultFactory factory) internal {
        usdcFirst = ArcChain.USDC_ERC20 < address(token);
        key = PoolKey({
            currency0: Currency.wrap(usdcFirst ? ArcChain.USDC_ERC20 : address(token)),
            currency1: Currency.wrap(usdcFirst ? address(token) : ArcChain.USDC_ERC20),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // 1 token (1e18 raw) == 1 USDC (1e6 raw). Uniswap prices raw against raw, so the ratio is
        // 1e12 one way and 1e-12 the other.
        manager.initialize(
            key, usdcFirst ? uint160(1e6 * (uint256(1) << 96)) : uint160((uint256(1) << 96) / 1e6)
        );
        console2.log("pool id");
        console2.logBytes32(PoolId.unwrap(key.toId()));

        vault = LiquidityVault(factory.createVault(key));
        console2.log("LiquidityVault   ", address(vault));
    }

    function _stake() internal {
        usdc.approve(address(vault), type(uint256).max);
        token.approve(address(vault), type(uint256).max);

        (uint256 amount0, uint256 amount1) =
            usdcFirst ? (USDC_LIQUIDITY, TOKEN_LIQUIDITY) : (TOKEN_LIQUIDITY, USDC_LIQUIDITY);
        console2.log("shares minted    ", vault.deposit(amount0, amount1, 0, msg.sender));
    }

    function _trade() internal {
        usdc.approve(address(swapRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);

        // Both directions, so fees accrue on both sides of the pair.
        _swap(usdcFirst, SWAP_SIZE_USDC);
        _swap(!usdcFirst, SWAP_SIZE_TOKEN);
        console2.log("swaps done");
    }

    function _harvest() internal {
        vault.poke();
        (uint256 streamed, uint256 queued) = vault.harvest();
        console2.log("streamed (usdc)  ", streamed);
        console2.log("queued (usdc)    ", queued);
    }

    function _report() internal view {
        console2.log("--- post-harvest state ---");
        console2.log("deferred (token) ", vault.pendingAssetFees());
        console2.log("reward rate      ", vault.rewardRate());
        console2.log("total liquidity  ", vault.totalLiquidity());
        console2.log("--- record these ---");
        console2.log("DELTA_TOKEN      ", address(token));
        console2.log("DELTA_VAULT      ", address(vault));
        console2.log("DELTA_SWAP_ROUTER", address(swapRouter));
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
