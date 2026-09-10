// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {EACBaseRolesLib} from "@ensdomains/contracts-v2/access-control/libraries/EACBaseRolesLib.sol";
import {PermissionedRegistry} from "@ensdomains/contracts-v2/registry/PermissionedRegistry.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "@ensdomains/contracts-v2/registry/libraries/RegistryRolesLib.sol";
import {PermissionedResolver} from "@ensdomains/contracts-v2/resolver/PermissionedResolver.sol";
import {IContractNamer} from "@ensdomains/contracts-v2/reverse-registrar/interfaces/IContractNamer.sol";
import {LabelStore} from "@ensdomains/contracts-v2/utils/LabelStore.sol";
import {VerifiableFactory} from "@ensdomains/verifiable-factory/VerifiableFactory.sol";

import {AdInventoryRegistry} from "../src/AdInventoryRegistry.sol";
import {ENSv2AuthorizationAdapter} from "../src/ENSv2AuthorizationAdapter.sol";
import {IAdInventoryRegistry} from "../src/interfaces/IAdInventoryRegistry.sol";
import {ProofAdsMarket} from "../src/ProofAdsMarket.sol";
import {ProofAdsSettlementReceiver} from "../src/ProofAdsSettlementReceiver.sol";
import {MockUSDC} from "../src/testing/MockUSDC.sol";
import {EnsNames} from "./lib/EnsNames.sol";

/// @notice Stands up a complete, self-contained ENSv2 + ProofAds world on a local chain.
///
/// @dev The ENSv2 pieces (`LabelStore`, `PermissionedRegistry`, `PermissionedResolver`,
///      `VerifiableFactory`) are the unmodified upstream contracts from `ensdomains/contracts-v2`,
///      so local behaviour matches the Sepolia beta. `DeploySepolia.s.sol` instead points at
///      ENS's already-deployed instances.
///
///      Hierarchy built here:
///        root ── "eth" ─> ethRegistry ── "proofads-pub" ─> userRegistry
///                                          └─ "ads" ─> AdInventoryRegistry ── "hero", "sidebar"
contract DeployLocal is Script {
    uint256 internal constant OWNER_SLOT_ROLES = RegistryRolesLib.ROLE_SET_RESOLVER
        | RegistryRolesLib.ROLE_SET_RESOLVER_ADMIN | RegistryRolesLib.ROLE_SET_SUBREGISTRY
        | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN | RegistryRolesLib.ROLE_RENEW
        | RegistryRolesLib.ROLE_RENEW_ADMIN | RegistryRolesLib.ROLE_UNREGISTER
        | RegistryRolesLib.ROLE_UNREGISTER_ADMIN;

    string internal constant PUBLISHER_LABEL = "proofads-pub";
    string internal constant ADS_LABEL = "ads";

    LabelStore internal labelStore;
    VerifiableFactory internal factory;
    PermissionedRegistry internal rootRegistry;
    PermissionedRegistry internal ethRegistry;
    PermissionedRegistry internal userRegistry;
    AdInventoryRegistry internal adInventory;
    address internal resolver;
    MockUSDC internal usdc;
    ENSv2AuthorizationAdapter internal adapter;
    ProofAdsMarket internal market;
    ProofAdsSettlementReceiver internal receiver;

    uint256 internal deployerKey;
    uint256 internal publisherKey;
    address internal deployer;
    address internal publisher;
    address internal forwarder;
    uint64 internal expiry;

    function run() external {
        deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        publisherKey = vm.envUint("PUBLISHER_PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        publisher = vm.addr(publisherKey);
        forwarder = vm.envAddress("KEYSTONE_FORWARDER");
        expiry = uint64(block.timestamp + 365 days);

        _deployEnsCore();
        _deployPublisherNamespace();
        _registerSlots();
        _setTextRecords();
        _deployProofAds();
        _write();
    }

    function _deployEnsCore() internal {
        vm.startBroadcast(deployerKey);
        labelStore = new LabelStore(IContractNamer(address(0)));
        factory = new VerifiableFactory();
        rootRegistry = new PermissionedRegistry(labelStore, deployer, EACBaseRolesLib.ALL_ROLES);
        ethRegistry = new PermissionedRegistry(labelStore, deployer, EACBaseRolesLib.ALL_ROLES);
        rootRegistry.register("eth", deployer, IRegistry(address(ethRegistry)), address(0), OWNER_SLOT_ROLES, expiry);
        ethRegistry.setParent(IRegistry(address(rootRegistry)), "eth");
        vm.stopBroadcast();
    }

    function _deployPublisherNamespace() internal {
        vm.startBroadcast(publisherKey);
        PermissionedResolver resolverImpl = new PermissionedResolver(publisher);
        resolver = factory.deployProxy(
            address(resolverImpl),
            uint256(keccak256("proofads-resolver")),
            abi.encodeCall(PermissionedResolver.initialize, (publisher, EACBaseRolesLib.ALL_ROLES, new bytes[](0)))
        );
        userRegistry = new PermissionedRegistry(labelStore, publisher, EACBaseRolesLib.ALL_ROLES);
        adInventory = new AdInventoryRegistry(labelStore, publisher);
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        ethRegistry.register(
            PUBLISHER_LABEL, publisher, IRegistry(address(userRegistry)), resolver, OWNER_SLOT_ROLES, expiry
        );
        vm.stopBroadcast();
    }

    function _registerSlots() internal {
        vm.startBroadcast(publisherKey);
        userRegistry.setParent(IRegistry(address(ethRegistry)), PUBLISHER_LABEL);
        userRegistry.register(
            ADS_LABEL, publisher, IRegistry(address(adInventory)), resolver, OWNER_SLOT_ROLES, expiry
        );
        adInventory.setParent(IRegistry(address(userRegistry)), ADS_LABEL);
        adInventory.register("hero", publisher, IRegistry(address(0)), resolver, OWNER_SLOT_ROLES, expiry);
        adInventory.register("sidebar", publisher, IRegistry(address(0)), resolver, OWNER_SLOT_ROLES, expiry);
        vm.stopBroadcast();
    }

    function _setTextRecords() internal {
        string memory demoDomain = vm.envOr("DEMO_DOMAIN", string("sepolia-times.local"));
        bytes32 adsNode =
            EnsNames.child(EnsNames.child(EnsNames.child(bytes32(0), "eth"), PUBLISHER_LABEL), ADS_LABEL);

        vm.startBroadcast(publisherKey);
        PermissionedResolver res = PermissionedResolver(resolver);
        res.setText(EnsNames.child(adsNode, "hero"), "com.proofads.placement", "homepage-hero");
        res.setText(EnsNames.child(adsNode, "hero"), "com.proofads.domain", demoDomain);
        res.setText(EnsNames.child(adsNode, "sidebar"), "com.proofads.placement", "homepage-sidebar");
        res.setText(EnsNames.child(adsNode, "sidebar"), "com.proofads.domain", demoDomain);
        vm.stopBroadcast();
    }

    function _deployProofAds() internal {
        vm.startBroadcast(deployerKey);
        usdc = new MockUSDC();
        adapter = new ENSv2AuthorizationAdapter(IAdInventoryRegistry(address(adInventory)));
        market = new ProofAdsMarket(usdc, adapter, false);
        receiver = new ProofAdsSettlementReceiver(forwarder, market);
        market.setSettlementReceiver(address(receiver));
        usdc.mint(vm.envAddress("ADVERTISER_A_ADDRESS"), 1_000e6);
        usdc.mint(vm.envAddress("ADVERTISER_B_ADDRESS"), 1_000e6);
        vm.stopBroadcast();
    }

    function _write() internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "labelStore", address(labelStore));
        vm.serializeAddress(obj, "verifiableFactory", address(factory));
        vm.serializeAddress(obj, "rootRegistry", address(rootRegistry));
        vm.serializeAddress(obj, "ethRegistry", address(ethRegistry));
        vm.serializeAddress(obj, "userRegistry", address(userRegistry));
        vm.serializeAddress(obj, "adInventoryRegistry", address(adInventory));
        vm.serializeAddress(obj, "publisherResolver", resolver);
        vm.serializeAddress(obj, "usdc", address(usdc));
        vm.serializeAddress(obj, "authorizationAdapter", address(adapter));
        vm.serializeAddress(obj, "market", address(market));
        vm.serializeAddress(obj, "settlementReceiver", address(receiver));
        vm.serializeAddress(obj, "publisher", publisher);
        vm.serializeString(obj, "publisherName", "proofads-pub.eth");
        string memory json = vm.serializeAddress(obj, "keystoneForwarder", forwarder);
        vm.writeJson(json, "./deployments/local.json");
        console.log("ProofAds local deployment written to deployments/local.json");
    }
}
