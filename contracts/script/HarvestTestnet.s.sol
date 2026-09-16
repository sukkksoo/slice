// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";

/// @notice Keeper pass over a live testnet vault: record a price observation, then harvest.
///
/// Run this every few minutes. The vault needs 30 minutes of accumulated observations before it
/// will price an internal swap, so the first few passes will report the token-side fees as still
/// deferred. Once `oracleWarm` flips true, the next harvest converts them and the reward rate
/// jumps — which is the whole cold-start path exercised on a real chain instead of with vm.warp.
///
///   DELTA_VAULT=0x… forge script script/HarvestTestnet.s.sol \
///     --rpc-url $ARC_TESTNET_RPC_URL --broadcast
contract HarvestTestnet is Script {
    error WrongChain(uint256 actual);

    function run() external {
        if (block.chainid != ArcChain.TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        LiquidityVault vault = LiquidityVault(vm.envAddress("DELTA_VAULT"));

        (bool warmBefore,,) = vault.prices();
        console2.log("oracle warm      ", warmBefore);
        console2.log("deferred (token) ", vault.pendingAssetFees());
        console2.log("reward rate      ", vault.rewardRate());
        console2.log("queued (usdc)    ", vault.pendingCompound());

        vm.startBroadcast();
        vault.poke();
        (uint256 streamed, uint256 queued) = vault.harvest();
        vm.stopBroadcast();

        (bool warmAfter,,) = vault.prices();
        console2.log("--- after ---");
        console2.log("oracle warm      ", warmAfter);
        console2.log("streamed (usdc)  ", streamed);
        console2.log("queued (usdc)    ", queued);
        console2.log("deferred (token) ", vault.pendingAssetFees());
        console2.log("reward rate      ", vault.rewardRate());
        console2.log("claimable to you ", vault.earned(msg.sender));
    }
}
