// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ILabelStore} from "@ensdomains/contracts-v2/utils/interfaces/ILabelStore.sol";

import {AdInventoryRegistry} from "../src/AdInventoryRegistry.sol";
import {ENSv2AuthorizationAdapter} from "../src/ENSv2AuthorizationAdapter.sol";
import {IAdInventoryRegistry} from "../src/interfaces/IAdInventoryRegistry.sol";
import {ProofAdsMarket} from "../src/ProofAdsMarket.sol";
import {ProofAdsSettlementReceiver} from "../src/ProofAdsSettlementReceiver.sol";
import {SepoliaEnsV2} from "./lib/SepoliaEnsV2.sol";

/// @notice Step 1 of the Sepolia deployment: the ProofAds contracts themselves.
///
/// @dev Deliberately does no ENS name plumbing — `SetupInventorySepolia.s.sol` does that, so a
///      failure in one does not force a redeploy of the other. `DEV_MODE` is hardcoded false:
///      the only path into settlement on a public network is the Chainlink receiver.
///
/// Usage:
///   forge script script/DeploySepolia.s.sol:DeploySepolia \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
contract DeploySepolia is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address publisher = vm.envAddress("PUBLISHER_ADDRESS");
        address labelStore = vm.envOr("ENS_LABEL_STORE", SepoliaEnsV2.LABEL_STORE);
        address usdc = vm.envOr("USDC_ADDRESS", SepoliaEnsV2.CIRCLE_USDC);
        address forwarder = vm.envOr("KEYSTONE_FORWARDER", SepoliaEnsV2.KEYSTONE_FORWARDER);

        _requireCode(labelStore, "ENS LabelStore");
        _requireCode(usdc, "USDC");
        _requireCode(forwarder, "KeystoneForwarder");
        require(publisher != address(0), "PUBLISHER_ADDRESS is required");

        vm.startBroadcast(deployerKey);
        AdInventoryRegistry registry = new AdInventoryRegistry(ILabelStore(labelStore), publisher);
        ENSv2AuthorizationAdapter adapter =
            new ENSv2AuthorizationAdapter(IAdInventoryRegistry(address(registry)));
        ProofAdsMarket market = new ProofAdsMarket(IERC20(usdc), adapter, false);
        ProofAdsSettlementReceiver receiver = new ProofAdsSettlementReceiver(forwarder, market);
        market.setSettlementReceiver(address(receiver));
        vm.stopBroadcast();

        console.log("AdInventoryRegistry      ", address(registry));
        console.log("ENSv2AuthorizationAdapter", address(adapter));
        console.log("ProofAdsMarket           ", address(market));
        console.log("ProofAdsSettlementReceiver", address(receiver));
        console.log("DEV_MODE                  false");

        string memory obj = "sepolia";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "adInventoryRegistry", address(registry));
        vm.serializeAddress(obj, "authorizationAdapter", address(adapter));
        vm.serializeAddress(obj, "market", address(market));
        vm.serializeAddress(obj, "settlementReceiver", address(receiver));
        vm.serializeAddress(obj, "usdc", usdc);
        vm.serializeAddress(obj, "keystoneForwarder", forwarder);
        vm.serializeAddress(obj, "labelStore", labelStore);
        vm.serializeAddress(obj, "rootRegistry", SepoliaEnsV2.ROOT_REGISTRY);
        vm.serializeAddress(obj, "ethRegistry", SepoliaEnsV2.ETH_REGISTRY);
        vm.serializeAddress(obj, "publisher", publisher);
        vm.serializeString(obj, "publisherName", vm.envOr("PUBLISHER_NAME", string("proofads-pub.eth")));
        // Filled in by SetupInventorySepolia.
        vm.serializeAddress(obj, "userRegistry", address(0));
        string memory json = vm.serializeAddress(obj, "publisherResolver", address(0));
        vm.writeJson(json, "./deployments/sepolia.json");
        console.log("Wrote deployments/sepolia.json");
    }

    function _requireCode(address target, string memory what) internal view {
        require(target.code.length > 0, string.concat("no bytecode at ", what));
    }
}
