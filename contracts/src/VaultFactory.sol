// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {LiquidityVault} from "./LiquidityVault.sol";
import {VaultDeployer} from "./VaultDeployer.sol";
import {FeeRouter} from "./FeeRouter.sol";
import {ArcChain} from "./libraries/ArcChain.sol";

/// @title VaultFactory
/// @notice Deploys one LiquidityVault per Uniswap v4 pool, plus optional creator fee routers.
/// @dev One vault per pool id, enforced on-chain. Letting two vaults share a pool would split the
///      position and the fee stream between them for no benefit, and would make the dashboard's
///      per-pool TVL ambiguous.
contract VaultFactory {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;

    /// @notice Holds the vault creation bytecode; see VaultDeployer for why it is not inlined here.
    VaultDeployer public immutable vaultDeployer;

    address public owner;
    address public treasury;

    /// @notice The vault for a given pool id, or the zero address if none exists yet.
    mapping(PoolId => address) public vaultForPool;
    address[] public allVaults;

    /// @notice Routers deployed for a vault, in creation order.
    mapping(address => address[]) public routersForVault;

    event VaultCreated(PoolId indexed poolId, address indexed vault, address indexed creator, string symbol);
    event RouterCreated(address indexed vault, address indexed router, address indexed creator);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    error NotOwner();
    error ZeroAddress();
    error VaultExists();
    error PoolNotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager _poolManager, VaultDeployer _vaultDeployer, address _owner, address _treasury) {
        if (_owner == address(0) || _treasury == address(0)) revert ZeroAddress();
        if (address(_vaultDeployer) == address(0)) revert ZeroAddress();
        poolManager = _poolManager;
        vaultDeployer = _vaultDeployer;
        owner = _owner;
        treasury = _treasury;
        emit OwnerUpdated(address(0), _owner);
        emit TreasuryUpdated(address(0), _treasury);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function routerCount(address vault) external view returns (uint256) {
        return routersForVault[vault].length;
    }

    /// @notice Deploy the vault for `key`. Permissionless: any pool that quotes USDC qualifies.
    /// @dev The pool must already be initialized. Deploying a vault against an uninitialized pool
    ///      would let the deployer pick the starting price on first deposit.
    function createVault(PoolKey calldata key) external returns (address vault) {
        PoolId id = key.toId();
        if (vaultForPool[id] != address(0)) revert VaultExists();

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(id);
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();

        string memory symbol = _assetSymbol(key);
        vault = vaultDeployer.deploy(poolManager, key, owner, treasury, symbol);

        vaultForPool[id] = vault;
        allVaults.push(vault);

        emit VaultCreated(id, vault, msg.sender, symbol);
    }

    /// @notice Deploy a fee router that injects liquidity into `vault` on the caller's behalf.
    /// @param injectionRecipient Where the vault shares minted by each injection are sent. Use a
    ///        burn address to make the injected liquidity permanent.
    function createRouter(address vault, address injectionRecipient) external returns (address router) {
        if (vault == address(0) || injectionRecipient == address(0)) revert ZeroAddress();

        router = address(new FeeRouter(LiquidityVault(vault), msg.sender, injectionRecipient));
        routersForVault[vault].push(router);

        emit RouterCreated(vault, router, msg.sender);
    }

    /// @notice Symbol of the non-USDC side, used to name the vault's share token.
    /// @dev Tokens that return a non-standard symbol are tolerated: the name is cosmetic and must
    ///      never be able to block vault creation.
    function _assetSymbol(PoolKey calldata key) internal view returns (string memory) {
        address assetToken = Currency.unwrap(key.currency0) == ArcChain.USDC_ERC20
            ? Currency.unwrap(key.currency1)
            : Currency.unwrap(key.currency0);

        try IERC20Metadata(assetToken).symbol() returns (string memory s) {
            return bytes(s).length == 0 ? "TOKEN" : s;
        } catch {
            return "TOKEN";
        }
    }

    // --- governance ---

    /// @dev Only affects vaults deployed after the change; existing vaults keep their own owner.
    function setOwner(address _owner) external onlyOwner {
        if (_owner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, _owner);
        owner = _owner;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }
}
