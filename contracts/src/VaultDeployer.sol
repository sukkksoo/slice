// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {LiquidityVault} from "./LiquidityVault.sol";

/// @title VaultDeployer
/// @notice Holds the LiquidityVault creation bytecode so the factory does not have to.
///
/// @dev A contract that calls `new LiquidityVault(...)` carries the vault's entire initcode in its
///      own runtime code. With the vault at ~21KB, a factory that also deployed routers and kept a
///      registry came to ~31KB — over the 24,576-byte EIP-170 limit and undeployable. Splitting the
///      creation code into its own contract puts both halves comfortably under the limit.
///
/// @dev Deployment is a three-step dance: deploy this, deploy the factory pointing at it, then
///      call `setFactory`. The factory cannot deploy this itself, because doing so would pull the
///      initcode straight back into the factory and recreate the size problem.
contract VaultDeployer {
    /// @notice The account that deployed this contract and may nominate the factory once.
    address public immutable admin;

    /// @notice The only address permitted to deploy vaults through this contract.
    address public factory;

    event FactorySet(address indexed factory);

    error NotAdmin();
    error NotFactory();
    error FactoryAlreadySet();
    error ZeroAddress();

    constructor() {
        admin = msg.sender;
    }

    /// @notice Bind this deployer to its factory. Callable once, by the admin.
    function setFactory(address _factory) external {
        if (msg.sender != admin) revert NotAdmin();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
        emit FactorySet(_factory);
    }

    /// @notice Deploy a vault for `key`.
    /// @dev Plain CREATE rather than CREATE2. A deterministic address keyed on the pool id would
    ///      let anyone occupy the salt first and permanently block that pool's vault; the factory's
    ///      registry is what makes a vault canonical, so the address itself need not be predictable.
    function deploy(
        IPoolManager poolManager,
        PoolKey calldata key,
        address owner,
        address treasury,
        string calldata symbol
    ) external returns (address vault) {
        if (msg.sender != factory) revert NotFactory();
        vault = address(new LiquidityVault(poolManager, key, owner, treasury, symbol));
    }
}
