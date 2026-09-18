#!/usr/bin/env bash
# Builds the DeforestationFree circuit end-to-end (PRD 5.3):
#   compile -> test inputs -> witness -> Groth16 setup -> one phase-2 contribution
#   -> export verification key + Solidity verifier -> sanity prove/verify -> contract fixture.
#
# Requires circom 2.1.x, snarkjs, node, `npm install` done in the repo root, and
# circuits/pot16_final.ptau (see docs/decisions.md 0.7 for how it was generated).
#
# NOTE: the phase-2 contribution uses fresh randomness, so every run yields a new zkey /
# verification key / Groth16Verifier.sol that only match each other. After a rebuild the
# verifier must be redeployed and the new zkey shipped to the frontend.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
CIRCUIT=deforestation_free
PTAU=pot16_final.ptau
BUILD=build

[ -f "$PTAU" ] || { echo "error: circuits/$PTAU not found (see docs/decisions.md 0.7)" >&2; exit 1; }
[ -d "$ROOT/node_modules/circomlib" ] || { echo "error: run 'npm install' in the repo root first" >&2; exit 1; }

mkdir -p "$BUILD"

echo "== 1/8 compile"
circom "$CIRCUIT.circom" --r1cs --wasm --sym -o "$BUILD" -l "$ROOT/node_modules"
cp "$BUILD/${CIRCUIT}_js/$CIRCUIT.wasm" "$BUILD/$CIRCUIT.wasm"
snarkjs r1cs info "$BUILD/$CIRCUIT.r1cs"

echo "== 2/8 generate test inputs"
node scripts/gen_inputs.js

echo "== 3/8 witness (clean cell)"
node "$BUILD/${CIRCUIT}_js/generate_witness.js" "$BUILD/$CIRCUIT.wasm" test/inputs/clean.json "$BUILD/witness.wtns"

echo "== 4/8 groth16 setup"
snarkjs groth16 setup "$BUILD/$CIRCUIT.r1cs" "$PTAU" "$BUILD/${CIRCUIT}_0000.zkey"

echo "== 5/8 phase-2 contribution (single contribution, hackathon-grade)"
snarkjs zkey contribute "$BUILD/${CIRCUIT}_0000.zkey" "$BUILD/${CIRCUIT}_final.zkey" \
  --name="zkanopy dev contribution" -e="$(openssl rand -hex 32)"
rm -f "$BUILD/${CIRCUIT}_0000.zkey"

echo "== 6/8 export verification key + Solidity verifier"
snarkjs zkey export verificationkey "$BUILD/${CIRCUIT}_final.zkey" "$BUILD/verification_key.json"
snarkjs zkey export solidityverifier "$BUILD/${CIRCUIT}_final.zkey" "$ROOT/contracts/src/Groth16Verifier.sol"

echo "== 7/8 prove + verify (clean cell)"
snarkjs groth16 prove "$BUILD/${CIRCUIT}_final.zkey" "$BUILD/witness.wtns" "$BUILD/proof.json" "$BUILD/public.json"
snarkjs groth16 verify "$BUILD/verification_key.json" "$BUILD/public.json" "$BUILD/proof.json"

echo "== 8/8 write contract fixture"
node scripts/make_fixture.js

echo
echo "artifacts:"
echo "  circuits/$BUILD/$CIRCUIT.wasm"
echo "  circuits/$BUILD/${CIRCUIT}_final.zkey   (gitignored)"
echo "  circuits/$BUILD/verification_key.json"
echo "  contracts/src/Groth16Verifier.sol"
echo "  contracts/test/fixtures/proof_ok.json"
