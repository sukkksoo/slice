// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {Currency} from "v4-core/types/Currency.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";

/// @notice Minimal settle/take helpers for contracts that hold their own funds.
/// @dev Deliberately vendored rather than imported from v4-core's `test/utils` so that no
///      test-only code sits in the production dependency path.
library Settler {
    /// @notice Pay `amount` of `currency` that this contract owes the PoolManager.
    function pay(Currency currency, IPoolManager manager, uint256 amount) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            manager.settle{value: amount}();
        } else {
            manager.sync(currency);
            IERC20Minimal(Currency.unwrap(currency)).transfer(address(manager), amount);
            manager.settle();
        }
    }

    /// @notice Collect `amount` of `currency` the PoolManager owes, to `recipient`.
    function collect(Currency currency, IPoolManager manager, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        manager.take(currency, recipient, amount);
    }
}
