// Poseidon Merkle tree helpers shared by the circuit tests, oracle/04_build_merkle.js and
// (ported to TypeScript) frontend/src/lib/merkle.ts. Hashing uses circomlibjs so that values
// are bit-identical to circomlib's Poseidon inside the circuit.
//
// Conventions (PRD 5.2 / 5.3):
//   leaf            = Poseidon(3)([row, col, label])           label: 1 = clean, 0 = loss
//   zero leaf       = Poseidon(3)([0, 0, 0])                   for indices outside the grid
//   node            = Poseidon(2)([left, right])
//   leafIndex       = row * cols + col
//   pathIndices[i]  = bit i of leafIndex (0 = node is the left child at level i)
//   pathElements[i] = sibling node at level i
//
// All values are BigInt. Serialize with .toString() for JSON / circuit inputs.

const { buildPoseidon } = require("circomlibjs");

let poseidonPromise = null;

/** Returns a memoized circomlibjs Poseidon instance. */
function getPoseidon() {
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  return poseidonPromise;
}

/** Wraps a circomlibjs Poseidon instance into hash(inputs: (bigint|number|string)[]) => bigint. */
function makeHasher(poseidon) {
  const F = poseidon.F;
  return (inputs) => F.toObject(poseidon(inputs.map((x) => BigInt(x))));
}

/**
 * Builds a full binary Merkle tree of the given depth. Leaves beyond `leaves.length` are `zeroLeaf`.
 * Subtrees made only of zero leaves reuse a per-level cached zero node, so sparse trees are cheap.
 *
 * @returns {{ depth: number, layers: bigint[][], root: bigint, zeros: bigint[] }}
 *   layers[0] are the leaves, layers[depth][0] is the root.
 */
function buildTree(leaves, depth, hash, zeroLeaf) {
  const size = 1 << depth;
  if (leaves.length > size) {
    throw new Error(`too many leaves for depth ${depth}: ${leaves.length} > ${size}`);
  }

  const zeros = [BigInt(zeroLeaf)];
  for (let lvl = 1; lvl <= depth; lvl++) {
    zeros[lvl] = hash([zeros[lvl - 1], zeros[lvl - 1]]);
  }

  let layer = new Array(size);
  for (let i = 0; i < size; i++) {
    layer[i] = i < leaves.length ? BigInt(leaves[i]) : zeros[0];
  }
  const layers = [layer];

  for (let lvl = 0; lvl < depth; lvl++) {
    const next = new Array(layer.length / 2);
    for (let j = 0; j < next.length; j++) {
      const l = layer[2 * j];
      const r = layer[2 * j + 1];
      next[j] = l === zeros[lvl] && r === zeros[lvl] ? zeros[lvl + 1] : hash([l, r]);
    }
    layers.push(next);
    layer = next;
  }

  return { depth, layers, root: layers[depth][0], zeros };
}

/** Authentication path for `leafIndex`, in the form the circuit expects. */
function getPath(tree, leafIndex) {
  if (leafIndex < 0 || leafIndex >= tree.layers[0].length) {
    throw new Error(`leafIndex ${leafIndex} out of range`);
  }
  const pathElements = [];
  const pathIndices = [];
  let idx = leafIndex;
  for (let lvl = 0; lvl < tree.depth; lvl++) {
    pathElements.push(tree.layers[lvl][idx ^ 1]);
    pathIndices.push(idx & 1);
    idx >>= 1;
  }
  return { pathElements, pathIndices };
}

/** Recomputes the root from a leaf and its path; mirrors MerkleTreeChecker in the circuit. */
function computeRoot(leaf, pathElements, pathIndices, hash) {
  let node = BigInt(leaf);
  for (let i = 0; i < pathElements.length; i++) {
    const sib = BigInt(pathElements[i]);
    node = Number(pathIndices[i]) === 0 ? hash([node, sib]) : hash([sib, node]);
  }
  return node;
}

module.exports = { getPoseidon, makeHasher, buildTree, getPath, computeRoot };
