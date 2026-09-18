// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Registry} from "../src/Registry.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";

/// @dev Drives Registry with the real Groth16 proof from circuits/build.sh
///      (test/fixtures/proof_ok.json). Rebuilding the circuit regenerates the verifier
///      and the fixture together, so they always match.
contract RegistryTest is Test {
    using stdJson for string;

    // Mirror of Registry.Attested for vm.expectEmit.
    event Attested(
        uint256 indexed id,
        address indexed exporter,
        uint256 indexed gridId,
        uint256 nullifier,
        uint32 season,
        bytes32 commodityHash
    );

    Groth16Verifier internal verifier;
    Registry internal registry;

    uint256[2] internal pA;
    uint256[2][2] internal pB;
    uint256[2] internal pC;
    uint256[7] internal pub;

    address internal exporter;
    Registry.Grid internal grid;
    uint256 internal gridId;

    address internal constant STRANGER = address(0xBEEF);
    bytes32 internal constant COMMODITY = keccak256("1801:Cocoa beans");

    function setUp() public {
        verifier = new Groth16Verifier();
        registry = new Registry(address(verifier)); // this contract is owner + oracle

        string memory json = vm.readFile("test/fixtures/proof_ok.json");
        uint256[] memory a = json.readUintArray(".calldata.pA");
        uint256[] memory b0 = json.readUintArray(".calldata.pB[0]");
        uint256[] memory b1 = json.readUintArray(".calldata.pB[1]");
        uint256[] memory c = json.readUintArray(".calldata.pC");
        uint256[] memory s = json.readUintArray(".calldata.pubSignals");
        for (uint256 i = 0; i < 2; i++) {
            pA[i] = a[i];
            pB[0][i] = b0[i];
            pB[1][i] = b1[i];
            pC[i] = c[i];
        }
        for (uint256 i = 0; i < 7; i++) {
            pub[i] = s[i];
        }
        exporter = json.readAddress(".exporter");
        assertEq(pub[3], uint256(uint160(exporter)), "fixture exporter mismatch");

        grid = Registry.Grid({
            root: json.readUint(".grid.root"),
            lat0S: uint64(json.readUint(".grid.lat0S")),
            lon0S: uint64(json.readUint(".grid.lon0S")),
            stepS: uint64(json.readUint(".grid.stepS")),
            cols: uint32(json.readUint(".grid.cols")),
            rows: uint32(json.readUint(".grid.rows")),
            version: 1,
            publishedAt: 0,
            metadataURI: "ipfs://test-grid"
        });
        gridId = registry.registerRoot(grid);
    }

    function _attestAs(address who) internal returns (uint256) {
        vm.prank(who);
        return registry.attest(pA, pB, pC, pub, gridId, COMMODITY);
    }

    // ------------------------------------------------------------ required (PRD 5.4)

    function test_attest_success() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit Attested(1, exporter, gridId, pub[0], uint32(pub[2]), COMMODITY);

        uint256 id = _attestAs(exporter);
        assertEq(id, 1);

        Registry.Attestation memory at = registry.getAttestation(id);
        assertEq(at.id, 1);
        assertEq(at.exporter, exporter);
        assertEq(at.gridId, gridId);
        assertEq(at.nullifier, pub[0]);
        assertEq(at.season, 2026);
        assertEq(at.commodityHash, COMMODITY);
        assertEq(at.timestamp, uint64(block.timestamp));

        assertTrue(registry.nullifierUsed(pub[0]));
        assertEq(registry.attestationCount(), 1);
        uint256[] memory ids = registry.attestationsOf(exporter);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);
    }

    function test_revert_nullifier_reuse() public {
        _attestAs(exporter);
        vm.expectRevert(Registry.NullifierAlreadyUsed.selector);
        _attestAs(exporter);
        assertEq(registry.attestationCount(), 1);
    }

    function test_revert_invalid_proof() public {
        pA[0] ^= 1; // one flipped bit in the proof
        vm.expectRevert(Registry.InvalidProof.selector);
        _attestAs(exporter);
    }

    function test_revert_invalid_proof_tampered_public_signal() public {
        pub[2] = 2027; // season the proof was not made for
        vm.expectRevert(Registry.InvalidProof.selector);
        _attestAs(exporter);
    }

    function test_revert_unknown_root() public {
        // 1. registered grid whose root differs from the proof's root
        Registry.Grid memory other = grid;
        other.root = grid.root + 1;
        uint256 otherId = registry.registerRoot(other);
        vm.prank(exporter);
        vm.expectRevert(Registry.UnknownRootOrGrid.selector);
        registry.attest(pA, pB, pC, pub, otherId, COMMODITY);

        // 2. grid id that was never registered
        vm.prank(exporter);
        vm.expectRevert(Registry.UnknownRootOrGrid.selector);
        registry.attest(pA, pB, pC, pub, 999, COMMODITY);

        // 3. same root but different grid parameters
        Registry.Grid memory wrongStep = grid;
        wrongStep.stepS = grid.stepS + 1;
        uint256 wrongStepId = registry.registerRoot(wrongStep);
        vm.prank(exporter);
        vm.expectRevert(Registry.UnknownRootOrGrid.selector);
        registry.attest(pA, pB, pC, pub, wrongStepId, COMMODITY);
    }

    // ----------------------------------------------------------------- extras

    function test_revert_exporter_mismatch() public {
        vm.expectRevert(Registry.ExporterMismatch.selector);
        _attestAs(STRANGER);
    }

    function test_revert_register_not_oracle() public {
        vm.prank(STRANGER);
        vm.expectRevert(Registry.NotOracle.selector);
        registry.registerRoot(grid);
    }

    function test_set_oracle() public {
        registry.setOracle(address(0xCAFE));
        assertEq(registry.oracle(), address(0xCAFE));

        vm.prank(address(0xCAFE));
        assertEq(registry.registerRoot(grid), 2);

        vm.prank(STRANGER);
        vm.expectRevert(Registry.NotOwner.selector);
        registry.setOracle(STRANGER);
    }

    function test_grid_stored() public view {
        Registry.Grid memory g = registry.getGrid(gridId);
        assertEq(g.root, grid.root);
        assertEq(g.lat0S, grid.lat0S);
        assertEq(g.lon0S, grid.lon0S);
        assertEq(g.stepS, grid.stepS);
        assertEq(g.cols, 4);
        assertEq(g.rows, 4);
        assertEq(g.version, 1);
        assertEq(g.publishedAt, uint64(block.timestamp));
        assertEq(g.metadataURI, "ipfs://test-grid");
    }

    function test_revert_unknown_ids() public {
        vm.expectRevert(Registry.UnknownAttestation.selector);
        registry.getAttestation(1);
        vm.expectRevert(Registry.UnknownGrid.selector);
        registry.getGrid(2);
    }
}
