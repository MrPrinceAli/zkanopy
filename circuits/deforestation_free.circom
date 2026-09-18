pragma circom 2.1.0;

// ZKanopy — DeforestationFree circuit (PRD 5.3).
//
// Proves, without revealing the plot coordinates, that:
//   1. the private coordinate (latS, lonS) lies inside grid cell (row, col);
//   2. that cell is a *clean* leaf (label = 1) of the published Poseidon Merkle tree with root `root`;
// and exposes nullifier = Poseidon(row, col, season) so a cell can be attested at most once per season.
//
// Public signal order produced by snarkjs (DO NOT CHANGE after Phase 1, PRD 12.1):
//   [nullifier, root, season, exporter, lat0S, lon0S, stepS]

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// Orders (in[0], in[1]) as (left, right) when s = 0 and swaps them when s = 1.
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Recomputes the Poseidon Merkle root from `leaf` and its authentication path and
// constrains it to equal `root` (Tornado/Semaphore-style MerkleTreeChecker).
// pathIndices[i] = 0 means the running node is the left child at level i.
template MerkleTreeChecker(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component selectors[depth];
    component hashers[depth];

    for (var i = 0; i < depth; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== i == 0 ? leaf : hashers[i - 1].out;
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i].out[0];
        hashers[i].inputs[1] <== selectors[i].out[1];
    }

    root === hashers[depth - 1].out;
}

// Asserts lo <= x < hi. Every compared value is first proven to fit in 64 bits,
// which is what makes circomlib's LessThan/LessEqThan(64) sound.
template InRange64() {
    signal input x;
    signal input lo;
    signal input hi;

    component xBits = Num2Bits(64);
    xBits.in <== x;
    component loBits = Num2Bits(64);
    loBits.in <== lo;
    component hiBits = Num2Bits(64);
    hiBits.in <== hi;

    component geLo = LessEqThan(64);   // lo <= x
    geLo.in[0] <== lo;
    geLo.in[1] <== x;
    geLo.out === 1;

    component ltHi = LessThan(64);     // x < hi
    ltHi.in[0] <== x;
    ltHi.in[1] <== hi;
    ltHi.out === 1;
}

template DeforestationFree(depth) {
    // ---- private inputs ----
    signal input latS;               // fixed-point: round((lat + 90) * 1e6)
    signal input lonS;               // fixed-point: round((lon + 180) * 1e6)
    signal input row;
    signal input col;
    signal input pathElements[depth];
    signal input pathIndices[depth]; // 0/1

    // ---- public inputs (declaration order defines the public signal order) ----
    signal input root;
    signal input season;             // e.g. 2026
    signal input exporter;           // exporter address as a field element
    signal input lat0S;              // grid origin (bottom-left corner), fixed-point
    signal input lon0S;
    signal input stepS;              // cell size, fixed-point

    // ---- public output ----
    signal output nullifier;

    // 1. Cell range check: lat0S + row*stepS <= latS < lat0S + (row+1)*stepS, same for lon/col.
    signal rowStep <== row * stepS;
    signal colStep <== col * stepS;
    signal cellLatLo <== lat0S + rowStep;
    signal cellLatHi <== cellLatLo + stepS;
    signal cellLonLo <== lon0S + colStep;
    signal cellLonHi <== cellLonLo + stepS;

    component latRange = InRange64();
    latRange.x <== latS;
    latRange.lo <== cellLatLo;
    latRange.hi <== cellLatHi;

    component lonRange = InRange64();
    lonRange.x <== lonS;
    lonRange.lo <== cellLonLo;
    lonRange.hi <== cellLonHi;

    // 2. Leaf = Poseidon(row, col, 1). The constant 1 means only *clean* leaves can be proven.
    component leafHash = Poseidon(3);
    leafHash.inputs[0] <== row;
    leafHash.inputs[1] <== col;
    leafHash.inputs[2] <== 1;

    // 3. Merkle membership against the public root.
    component tree = MerkleTreeChecker(depth);
    tree.leaf <== leafHash.out;
    tree.root <== root;
    for (var i = 0; i < depth; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // 4. Nullifier = Poseidon(row, col, season): one attestation per cell per season.
    component nullifierHash = Poseidon(3);
    nullifierHash.inputs[0] <== row;
    nullifierHash.inputs[1] <== col;
    nullifierHash.inputs[2] <== season;
    nullifier <== nullifierHash.out;

    // 5. Bind the proof to the exporter so it cannot be replayed by another address.
    signal exporterSq <== exporter * exporter;
}

component main {public [root, season, exporter, lat0S, lon0S, stepS]} = DeforestationFree(16);
