// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {Registry} from "../src/Registry.sol";

/// @notice Deploys Groth16Verifier then Registry. The broadcasting account becomes owner and oracle.
///
///   cd contracts
///   forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
///
/// Record the printed addresses in frontend/src/config.ts and README.md.
contract Deploy is Script {
    function run() external returns (Groth16Verifier verifier, Registry registry) {
        vm.startBroadcast();
        verifier = new Groth16Verifier();
        registry = new Registry(address(verifier));
        vm.stopBroadcast();

        console2.log("Groth16Verifier:", address(verifier));
        console2.log("Registry:       ", address(registry));
        console2.log("Owner / oracle: ", registry.owner());
    }
}
