// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {LiquidityVault} from "../src/LiquidityVault.sol";
import {ArcChain} from "../src/libraries/ArcChain.sol";
import {BlocklistERC20} from "./mocks/BlocklistERC20.sol";

/// @notice The reported deposit, against the bytecode actually deployed at a live address.
///
/// Every other test compiles the vault from this working tree, which proves the source is fixed
/// and nothing about what is running on Arc. This one forks mainnet and calls a vault that is
/// already there, so what it exercises is the deployed code — the thing a staker will hit.
///
/// Point it at a vault and run it:
///
///   SLICE_VAULT=0x... ARC_RPC_URL=https://rpc.mainnet.arc.io \
///     forge test --match-contract DeployedVault -vv
contract DeployedVaultTest is Test {
    BlocklistERC20 usdc = BlocklistERC20(ArcChain.USDC_ERC20);

    LiquidityVault vault;
    address staker = makeAddr("staker");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_RPC_URL", string(""));
        address target = vm.envOr("SLICE_VAULT", address(0));
        if (bytes(rpc).length == 0 || target == address(0)) return;

        vm.createSelectFork(rpc);
        forked = true;
        vault = LiquidityVault(target);

        // Arc's USDC consults a compliance precompile Foundry does not implement, so a plain
        // ERC-20 stands in at its address. The vault, the pool and the hook are all the real
        // deployed ones — only the token this fork can move is substituted.
        deployCodeTo(
            "BlocklistERC20.sol:BlocklistERC20",
            abi.encode("USD Coin", "USDC", uint8(6)),
            ArcChain.USDC_ERC20
        );
        usdc.mint(ArcChain.POOL_MANAGER, 10_000_000e6);
        usdc.mint(staker, 2e6);

        vm.prank(staker);
        usdc.approve(address(vault), type(uint256).max);
    }

    modifier onlyForked() {
        if (!forked) {
            console2.log("SKIPPED: set ARC_RPC_URL and SLICE_VAULT");
            return;
        }
        _;
    }

    /// @notice One dollar, USDC-only, into the empty vault that is live right now.
    function test_liveVaultAcceptsAFirstUsdcOnlyDeposit() public onlyForked {
        console2.log("vault    ", address(vault));
        console2.log("symbol   ", vault.symbol());
        console2.log("liquidity", vault.totalLiquidity());
        assertEq(vault.totalLiquidity(), 0, "expected a vault nobody has deposited into yet");

        // What the keeper will have done by the time anyone sees this listed. The ring needs
        // thirty minutes of span; warping gets there without waiting for it.
        for (uint256 i = 0; i < 34; i++) {
            vault.poke();
            vm.warp(block.timestamp + 90);
        }

        (bool warm, uint160 spot, uint160 twap) = vault.prices();
        uint256 dev = spot > twap
            ? (uint256(spot - twap) * 10_000) / twap
            : (uint256(twap - spot) * 10_000) / twap;
        console2.log("warm     ", warm);
        console2.log("deviation", dev);
        assertTrue(warm, "oracle did not warm");

        uint256 before = usdc.balanceOf(staker);
        vm.prank(staker);
        uint256 shares = vault.depositUsdc(1e6, 0, staker);

        console2.log("usdc spent", before - usdc.balanceOf(staker));
        console2.log("shares    ", shares);
        assertGt(shares, 0, "the deployed vault still cannot take a first deposit");

        // And out again, through the same hook.
        vm.prank(staker);
        (uint256 a0, uint256 a1) = vault.withdraw(shares, 0, 0, staker);
        console2.log("usdc back ", a0);
        console2.log("token back", a1);
        assertGt(a0 + a1, 0, "withdrawal returned nothing");
    }
}
