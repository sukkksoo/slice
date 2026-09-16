// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultDeployer} from "../src/VaultDeployer.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";

/// @notice Compatibility check against a real Argus launch on Arc mainnet.
///
/// Slice attaches to a Uniswap v4 pool rather than to a launchpad, so "does it work with Argus"
/// is really "does an Argus pool meet the vault's requirements". Rather than infer that from
/// marketing copy, this forks mainnet and builds a vault against an actual Argus pool.
///
/// Skipped unless ARC_RPC_URL is set:
///   ARC_RPC_URL=https://rpc.mainnet.arc.io forge test --match-contract ArgusFork -vv
contract ArgusForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev ARC101 — an Argus launch, deployed at block 21,161,445 on 2026-09-16.
    address constant ARGUS_TOKEN = 0xac61f15a9E41B62c484EFcC5DBd57044E1793A8f;

    /// @dev Read from the pool's Initialize event. The hook is per-pool; Argus deploys one each.
    address constant ARGUS_HOOK = 0x15d8EE821b82f2Cc067Ee2ab50a0eA826c812044;
    uint24 constant ARGUS_FEE = 10_000; // 1%
    int24 constant ARGUS_TICK_SPACING = 200;

    IPoolManager manager = IPoolManager(ArcChain.POOL_MANAGER);

    VaultFactory factory;
    PoolKey key;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;

        vm.createSelectFork(rpc);
        forked = true;

        VaultDeployer deployer = new VaultDeployer();
        factory = new VaultFactory(manager, deployer, address(this), address(this));
        deployer.setFactory(address(factory));

        // USDC's address sorts below any normally-deployed token, so it is currency0.
        key = PoolKey({
            currency0: Currency.wrap(ArcChain.USDC_ERC20),
            currency1: Currency.wrap(ARGUS_TOKEN),
            fee: ARGUS_FEE,
            tickSpacing: ARGUS_TICK_SPACING,
            hooks: IHooks(ARGUS_HOOK)
        });
    }

    modifier onlyForked() {
        if (!forked) {
            console2.log("SKIPPED: set ARC_RPC_URL to run the Argus compatibility check");
            return;
        }
        _;
    }

    /// @notice The pool key reconstructed from the Initialize event is the real, live pool.
    function test_poolIsLiveOnMainnet() public view onlyForked {
        PoolId id = key.toId();
        (uint160 sqrtPriceX96, int24 tick,, uint24 lpFee) = manager.getSlot0(id);
        uint128 liquidity = manager.getLiquidity(id);

        console2.log("pool id");
        console2.logBytes32(PoolId.unwrap(id));
        console2.log("sqrtPriceX96", sqrtPriceX96);
        console2.log("tick        ", tick);
        console2.log("lpFee       ", lpFee);
        console2.log("liquidity   ", liquidity);

        assertGt(sqrtPriceX96, 0, "pool is not initialized");
        assertGt(liquidity, 0, "pool has no liquidity");
        assertEq(lpFee, ARGUS_FEE, "unexpected fee tier");
    }

    /// @notice The hook does not implement any callback that could interfere with an exit.
    /// @dev This is the check that decides whether Slice will touch a launchpad's pools at all.
    function test_argusHookCannotBlockExit() public pure {
        uint160 flags = uint160(ARGUS_HOOK) & 0x3FFF;

        uint160 BEFORE_REMOVE = 1 << 9;
        uint160 AFTER_REMOVE = 1 << 8;
        uint160 AFTER_REMOVE_DELTA = 1 << 0;
        uint160 AFTER_ADD_DELTA = 1 << 1;

        assertEq(flags & BEFORE_REMOVE, 0, "hook runs before remove-liquidity");
        assertEq(flags & AFTER_REMOVE, 0, "hook runs after remove-liquidity");
        assertEq(flags & AFTER_REMOVE_DELTA, 0, "hook can skim a withdrawal");
        assertEq(flags & AFTER_ADD_DELTA, 0, "hook can skim a deposit");

        // It does tax swaps, which is the expected launchpad shape and is allowed.
        assertGt(flags & (1 << 6), 0, "expected an afterSwap hook");
        assertGt(flags & (1 << 2), 0, "expected afterSwap to return a delta");
    }

    /// @notice A vault can actually be created for the pool, hook and all.
    function test_vaultCanBeCreatedForAnArgusPool() public onlyForked {
        address vaultAddress = factory.createVault(key);
        LiquidityVault vault = LiquidityVault(vaultAddress);

        assertEq(Currency.unwrap(vault.rewardCurrency()), ArcChain.USDC_ERC20, "rewards not in USDC");
        assertEq(Currency.unwrap(vault.assetCurrency()), ARGUS_TOKEN, "wrong asset side");
        assertTrue(vault.usdcIsCurrency0(), "expected USDC as currency0");
        assertEq(address(vault.poolKey().hooks), ARGUS_HOOK, "hook not carried through");

        console2.log("vault       ", vaultAddress);
        console2.log("share symbol", vault.symbol());
        console2.log("asset symbol", IERC20Metadata(ARGUS_TOKEN).symbol());
    }

    // --- a busier pool: CINU, and what its hook actually charges ---

    address constant CINU = 0xBDBB76DB770cC99DCF3FA31C42C171b9584D6a10;
    address constant CINU_HOOK = 0x110C4Ae6dFd0376CAB3B5367256b4C56fE2De044;

    function _cinuKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(ArcChain.USDC_ERC20),
            currency1: Currency.wrap(CINU),
            fee: ARGUS_FEE,
            tickSpacing: ARGUS_TICK_SPACING,
            hooks: IHooks(CINU_HOOK)
        });
    }

    function test_cinuPoolIsLiveAndVaultable() public onlyForked {
        PoolKey memory k = _cinuKey();
        (uint160 sqrtPriceX96,,, uint24 lpFee) = manager.getSlot0(k.toId());
        uint128 liquidity = manager.getLiquidity(k.toId());

        console2.log("CINU liquidity", liquidity);
        console2.log("CINU lpFee    ", lpFee);
        assertGt(liquidity, 0, "no liquidity");
        assertGt(sqrtPriceX96, 0, "not initialized");

        address v = factory.createVault(k);
        assertEq(Currency.unwrap(LiquidityVault(v).assetCurrency()), CINU, "wrong asset side");
    }

    /// @notice The hook's swap tax cannot be measured in a fork — see script/measure-hook-tax.sh.
    ///
    /// @dev The Argus hook transfers USDC to its treasury inside `afterSwap`, which goes through
    ///      Arc's balance-move precompile. That has no implementation in Foundry's EVM, so any
    ///      swap through this pool reverts in a fork even though it works on-chain. The tax is
    ///      therefore measured with `eth_call` against a live node instead, pinned to one block so
    ///      the pool cannot move mid-measurement. Measured repeatedly at 300 bps, plus the pool's
    ///      own 1% — which together are the 400 the hook's `totalFeeBps()` reports.

    /// @notice A second vault for the same pool is refused, so there is one canonical vault.
    function test_onlyOneVaultPerArgusPool() public onlyForked {
        factory.createVault(key);
        vm.expectRevert(VaultFactory.VaultExists.selector);
        factory.createVault(key);
    }
}
