// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {EACBaseRolesLib} from "@ensdomains/contracts-v2/access-control/libraries/EACBaseRolesLib.sol";
import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {IStandardRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IStandardRegistry.sol";
import {RegistryRolesLib} from "@ensdomains/contracts-v2/registry/libraries/RegistryRolesLib.sol";
import {PermissionedResolver} from "@ensdomains/contracts-v2/resolver/PermissionedResolver.sol";
import {IVerifiableFactory} from "@ensdomains/verifiable-factory/IVerifiableFactory.sol";

import {AdInventoryRegistry} from "../src/AdInventoryRegistry.sol";
import {EnsNames} from "./lib/EnsNames.sol";
import {SepoliaEnsV2} from "./lib/SepoliaEnsV2.sol";

/// @notice Step 2 of the Sepolia deployment: hang the ad inventory off a real `.eth` name.
///
/// Prerequisite: the publisher wallet already owns `<PUBLISHER_LABEL>.eth` on the ENSv2 Sepolia
/// beta (register it in the Sepolia ENS app, or with `CommitEthName` + `RegisterEthName`).
///
/// Builds:  <publisher>.eth ──> UserRegistry (proxy) ──"ads"──> AdInventoryRegistry ──> hero, sidebar
///
/// Every transaction here is signed by the publisher, because ENSv2 gives the name's owner the
/// admin roles. The deployer key is not involved.
contract SetupInventorySepolia is Script {
    uint256 internal constant OWNER_SLOT_ROLES = RegistryRolesLib.ROLE_SET_RESOLVER
        | RegistryRolesLib.ROLE_SET_RESOLVER_ADMIN | RegistryRolesLib.ROLE_SET_SUBREGISTRY
        | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN | RegistryRolesLib.ROLE_RENEW
        | RegistryRolesLib.ROLE_RENEW_ADMIN | RegistryRolesLib.ROLE_UNREGISTER
        | RegistryRolesLib.ROLE_UNREGISTER_ADMIN;

    uint256 internal publisherKey;
    address internal publisher;
    string internal publisherLabel;
    address internal adInventory;
    address internal userRegistry;
    address internal resolver;
    uint64 internal expiry;

    function run() external {
        publisherKey = vm.envUint("PUBLISHER_PRIVATE_KEY");
        publisher = vm.addr(publisherKey);
        publisherLabel = vm.envOr("PUBLISHER_LABEL", string("proofads-pub"));
        adInventory = vm.envAddress("AD_INVENTORY_REGISTRY");
        expiry = uint64(block.timestamp + 365 days);

        _checkOwnership();
        _deployPublisherContracts();
        _wireNames();
        _setTextRecords();

        console.log("userRegistry     ", userRegistry);
        console.log("publisherResolver", resolver);
        console.log("hero    ", string.concat("hero.ads.", publisherLabel, ".eth"));
        console.log("sidebar ", string.concat("sidebar.ads.", publisherLabel, ".eth"));
        console.log("Merge userRegistry and publisherResolver into deployments/sepolia.json.");
    }

    function _checkOwnership() internal view {
        address ethRegistry = vm.envOr("ENS_ETH_REGISTRY", SepoliaEnsV2.ETH_REGISTRY);
        uint256 labelId = uint256(EnsNames.labelhash(publisherLabel));
        require(
            IPermissionedRegistry(ethRegistry).getOwner(labelId) == publisher,
            "publisher does not own <label>.eth on ENSv2 Sepolia"
        );
        address heroOwner = AdInventoryRegistry(adInventory).getOwner(uint256(EnsNames.labelhash("hero")));
        require(heroOwner == address(0) || heroOwner == publisher, "hero already owned by someone else");
    }

    function _deployPublisherContracts() internal {
        address factory = vm.envOr("ENS_VERIFIABLE_FACTORY", SepoliaEnsV2.VERIFIABLE_FACTORY);
        vm.startBroadcast(publisherKey);
        userRegistry = IVerifiableFactory(factory).deployProxy(
            vm.envOr("ENS_USER_REGISTRY_IMPL", SepoliaEnsV2.USER_REGISTRY_IMPL),
            uint256(keccak256(abi.encode("ProofAdsUserRegistry", publisherLabel))),
            abi.encodeWithSignature("initialize(address,uint256)", publisher, EACBaseRolesLib.ALL_ROLES)
        );
        resolver = IVerifiableFactory(factory).deployProxy(
            vm.envOr("ENS_PERMISSIONED_RESOLVER_IMPL", SepoliaEnsV2.PERMISSIONED_RESOLVER_IMPL),
            uint256(keccak256(abi.encode("ProofAdsResolver", publisherLabel))),
            abi.encodeCall(
                PermissionedResolver.initialize, (publisher, EACBaseRolesLib.ALL_ROLES, new bytes[](0))
            )
        );
        vm.stopBroadcast();
    }

    function _wireNames() internal {
        address ethRegistry = vm.envOr("ENS_ETH_REGISTRY", SepoliaEnsV2.ETH_REGISTRY);
        uint256 labelId = uint256(EnsNames.labelhash(publisherLabel));
        vm.startBroadcast(publisherKey);
        // <label>.eth now resolves into the publisher's own registry.
        IStandardRegistry(ethRegistry).setSubregistry(labelId, IRegistry(userRegistry));
        IStandardRegistry(ethRegistry).setResolver(labelId, resolver);
        // "ads" under it resolves into the ad inventory.
        IStandardRegistry(userRegistry).register(
            "ads", publisher, IRegistry(adInventory), resolver, OWNER_SLOT_ROLES, expiry
        );
        // The slots themselves.
        AdInventoryRegistry registry = AdInventoryRegistry(adInventory);
        registry.register("hero", publisher, IRegistry(address(0)), resolver, OWNER_SLOT_ROLES, expiry);
        registry.register("sidebar", publisher, IRegistry(address(0)), resolver, OWNER_SLOT_ROLES, expiry);
        // So Universal Resolver traversal can reconstruct the full names.
        registry.setParent(IRegistry(userRegistry), "ads");
        vm.stopBroadcast();
    }

    function _setTextRecords() internal {
        string memory demoDomain = vm.envOr("DEMO_DOMAIN", string("proofads.example"));
        bytes32 adsNode = EnsNames.child(
            EnsNames.child(EnsNames.child(bytes32(0), "eth"), publisherLabel), "ads"
        );
        vm.startBroadcast(publisherKey);
        PermissionedResolver res = PermissionedResolver(resolver);
        res.setText(EnsNames.child(adsNode, "hero"), "com.proofads.placement", "homepage-hero");
        res.setText(EnsNames.child(adsNode, "hero"), "com.proofads.domain", demoDomain);
        res.setText(EnsNames.child(adsNode, "sidebar"), "com.proofads.placement", "homepage-sidebar");
        res.setText(EnsNames.child(adsNode, "sidebar"), "com.proofads.domain", demoDomain);
        vm.stopBroadcast();
    }
}
