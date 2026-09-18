// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Interface of the snarkjs-generated verifier in contracts/src/Groth16Verifier.sol.
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[7] calldata pubSignals
    ) external view returns (bool);
}

/// @title ZKanopy Registry
/// @notice Stores published deforestation grids (Poseidon Merkle roots + grid parameters) and the
///         zero-knowledge attestations proving that an undisclosed plot lies in a *clean* cell of one
///         of those grids. A nullifier per (cell, season) prevents the same plot from being sold twice.
/// @dev Public signal layout of the circuit, frozen since Phase 1 (PRD 5.3):
///      [nullifier, root, season, exporter, lat0S, lon0S, stepS]
contract Registry {
    // ------------------------------------------------------------------ types

    struct Grid {
        uint256 root;
        uint64 lat0S;
        uint64 lon0S;
        uint64 stepS;
        uint32 cols;
        uint32 rows;
        uint32 version;
        uint64 publishedAt;
        string metadataURI; // IPFS/URL describing dataset, AI model and sha256(tree.json)
    }

    struct Attestation {
        uint256 id;
        address exporter;
        uint256 gridId;
        uint256 nullifier;
        uint32 season;
        bytes32 commodityHash; // keccak256(HS code + commodity description)
        uint64 timestamp;
    }

    // ----------------------------------------------------------------- errors

    error NotOwner();
    error NotOracle();
    error ZeroAddress();
    error InvalidGrid();
    error UnknownGrid();
    error UnknownRootOrGrid();
    error ExporterMismatch();
    error InvalidProof();
    error NullifierAlreadyUsed();
    error SeasonOutOfRange();
    error UnknownAttestation();

    // ----------------------------------------------------------------- events

    event RootRegistered(
        uint256 indexed gridId,
        uint256 indexed root,
        uint32 version,
        uint64 lat0S,
        uint64 lon0S,
        uint64 stepS,
        uint32 cols,
        uint32 rows,
        string metadataURI
    );
    event Attested(
        uint256 indexed id,
        address indexed exporter,
        uint256 indexed gridId,
        uint256 nullifier,
        uint32 season,
        bytes32 commodityHash
    );
    event OracleUpdated(address indexed previousOracle, address indexed newOracle);

    // ---------------------------------------------------------------- storage

    // Indices into the circuit's public signals.
    uint256 private constant SIG_NULLIFIER = 0;
    uint256 private constant SIG_ROOT = 1;
    uint256 private constant SIG_SEASON = 2;
    uint256 private constant SIG_EXPORTER = 3;
    uint256 private constant SIG_LAT0 = 4;
    uint256 private constant SIG_LON0 = 5;
    uint256 private constant SIG_STEP = 6;

    IGroth16Verifier public immutable verifier;
    address public immutable owner;
    address public oracle;

    uint256 public gridCount; // ids start at 1
    uint256 public attestationCount; // ids start at 1

    mapping(uint256 gridId => Grid) private _grids;
    mapping(uint256 id => Attestation) private _attestations;
    mapping(uint256 nullifier => bool) public nullifierUsed;
    mapping(address exporter => uint256[]) private _attestationsOf;

    // -------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    // ------------------------------------------------------------ constructor

    /// @param verifier_ Address of the deployed Groth16Verifier. Deployer becomes owner and oracle.
    constructor(address verifier_) {
        if (verifier_ == address(0)) revert ZeroAddress();
        verifier = IGroth16Verifier(verifier_);
        owner = msg.sender;
        oracle = msg.sender;
        emit OracleUpdated(address(0), msg.sender);
    }

    // ------------------------------------------------------------------ admin

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    // ----------------------------------------------------------------- oracle

    /// @notice Publishes a grid (Merkle root + parameters). `publishedAt` is overwritten with block time.
    function registerRoot(Grid calldata g) external onlyOracle returns (uint256 gridId) {
        if (g.root == 0 || g.stepS == 0 || g.cols == 0 || g.rows == 0) revert InvalidGrid();

        gridId = ++gridCount;
        Grid storage stored = _grids[gridId];
        stored.root = g.root;
        stored.lat0S = g.lat0S;
        stored.lon0S = g.lon0S;
        stored.stepS = g.stepS;
        stored.cols = g.cols;
        stored.rows = g.rows;
        stored.version = g.version;
        stored.publishedAt = uint64(block.timestamp);
        stored.metadataURI = g.metadataURI;

        emit RootRegistered(gridId, g.root, g.version, g.lat0S, g.lon0S, g.stepS, g.cols, g.rows, g.metadataURI);
    }

    // --------------------------------------------------------------- exporter

    /// @notice Verifies a DeforestationFree proof bound to `msg.sender` (the exporter) and records the attestation.
    /// @dev Checks run in the order fixed by PRD 5.4: grid/root -> exporter -> proof -> nullifier.
    function attest(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[7] calldata pubSignals,
        uint256 gridId,
        bytes32 commodityHash
    ) external returns (uint256 id) {
        Grid storage g = _grids[gridId];
        if (
            g.root == 0 || pubSignals[SIG_ROOT] != g.root || pubSignals[SIG_LAT0] != g.lat0S
                || pubSignals[SIG_LON0] != g.lon0S || pubSignals[SIG_STEP] != g.stepS
        ) revert UnknownRootOrGrid();

        if (pubSignals[SIG_EXPORTER] != uint256(uint160(msg.sender))) revert ExporterMismatch();

        if (!verifier.verifyProof(a, b, c, pubSignals)) revert InvalidProof();

        uint256 nullifier = pubSignals[SIG_NULLIFIER];
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();
        nullifierUsed[nullifier] = true;

        if (pubSignals[SIG_SEASON] > type(uint32).max) revert SeasonOutOfRange();
        uint32 season = uint32(pubSignals[SIG_SEASON]);

        id = ++attestationCount;
        _attestations[id] = Attestation({
            id: id,
            exporter: msg.sender,
            gridId: gridId,
            nullifier: nullifier,
            season: season,
            commodityHash: commodityHash,
            timestamp: uint64(block.timestamp)
        });
        _attestationsOf[msg.sender].push(id);

        emit Attested(id, msg.sender, gridId, nullifier, season, commodityHash);
    }

    // ------------------------------------------------------------------ views

    function getAttestation(uint256 id) external view returns (Attestation memory) {
        if (id == 0 || id > attestationCount) revert UnknownAttestation();
        return _attestations[id];
    }

    function attestationsOf(address exporter) external view returns (uint256[] memory) {
        return _attestationsOf[exporter];
    }

    function getGrid(uint256 gridId) external view returns (Grid memory) {
        if (gridId == 0 || gridId > gridCount) revert UnknownGrid();
        return _grids[gridId];
    }
}
