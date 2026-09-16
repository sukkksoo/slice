// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultDeployer} from "../src/VaultDeployer.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";

/// @notice Deploys the factory. Vaults and routers are then created permissionlessly per pool.
///
/// Dry run against a fork (no broadcast, nothing sent):
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL
///
/// Live (only with an explicit --broadcast):
///   forge script script/Deploy.s.sol --rpc-url $ARC_RPC_URL --broadcast --verify
contract Deploy is Script {
    error WrongChain(uint256 actual);
    error PoolManagerMissing();

    function run() external returns (VaultFactory factory, VaultDeployer deployer) {
        address owner = vm.envAddress("DELTA_OWNER");
        address treasury = vm.envAddress("DELTA_TREASURY");

        // Refuse to run anywhere but Arc. The v4 addresses in ArcChain are Arc-specific and would
        // otherwise be deployed against whatever happens to sit at those addresses elsewhere.
        if (block.chainid != ArcChain.CHAIN_ID && block.chainid != ArcChain.TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (ArcChain.POOL_MANAGER.code.length == 0) revert PoolManagerMissing();

        console2.log("chain id        ", block.chainid);
        console2.log("pool manager    ", ArcChain.POOL_MANAGER);
        console2.log("owner           ", owner);
        console2.log("treasury        ", treasury);

        vm.startBroadcast();
        // The deployer must exist before the factory: it carries the vault's creation bytecode,
        // which is what keeps the factory under the 24,576-byte contract size limit.
        deployer = new VaultDeployer();
        factory = new VaultFactory(IPoolManager(ArcChain.POOL_MANAGER), deployer, owner, treasury);
        deployer.setFactory(address(factory));
        vm.stopBroadcast();

        console2.log("VaultDeployer   ", address(deployer));
        console2.log("VaultFactory    ", address(factory));
    }
}
