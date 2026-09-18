# Devpost submission text — ZKanopy

Copy-paste material for the Devpost form (IEEE ClimateChain Global Hackathon 2026, track *Sustainable Supply Chains*).
Fill in the links marked `TODO` after publishing the repo and the video.

## Project name

ZKanopy

## Tagline (≤ 60 chars)

Prove your farm is deforestation-free — without revealing where it is.

## Inspiration

The EU Deforestation Regulation (EUDR) requires every plot behind a shipment of cocoa, coffee, palm oil or rubber to be
geolocated and checked against a 31 December 2020 cut-off. Today that means smallholders hand their raw coordinates to a
centralised traceability platform — a real data-sovereignty risk (land-grabbing, competitors, misuse) — and nothing stops
the same plot from being "sold" to several exporters. We wanted a way for a farmer to prove *"my plot has not been
deforested since 2020"* cryptographically, keep the coordinates on their own phone, and make double-selling detectable.

## What it does

1. An **oracle** builds a 200 × 200 grid of ~100 m cells over a coffee landscape in Aceh from Hansen Global Forest Change
   and Sentinel-2 NDVI (Google Earth Engine), labels each cell *clean* or *loss*, runs a **RandomForest quality check**
   on the labels, and publishes the grid's Poseidon **Merkle root** on Base Sepolia.
2. A **farmer** taps their plot on a map. Their browser computes the Merkle path locally and generates a **Groth16
   zero-knowledge proof** (~0.5 s) that the plot lies in a *clean* cell of the published grid. The coordinates never leave
   the device.
3. The **Registry contract** verifies the proof, records a **nullifier** derived from (cell, season) so the same plot
   cannot be attested twice in a season, and emits an attestation bound to the exporter's address.
4. The **exporter** collects attestations and exports a **Due Diligence Statement JSON** (conceptual mapping to TRACES
   DDS fields). Anyone can open `/verify/:id` without a wallet.
5. A second AI model, an **IsolationForest** over the on-chain claim log, scores exporters for suspicious claiming
   patterns (`/regulator`). *The blockchain guarantees the AI's input; the AI watches the blockchain.*

## How we built it

- **Circuit:** circom 2.1 + circomlib (Poseidon, comparators), Groth16 via snarkjs, depth-16 Merkle membership,
  64-bit range checks that bind the private coordinate to its cell, nullifier = Poseidon(row, col, season), exporter
  binding. 5 050 constraints; proofs in ~0.5 s in the browser.
- **Contracts:** Solidity 0.8.24 with Foundry; the snarkjs-generated verifier plus `Registry.sol`
  (`registerRoot`, `attest`, `getAttestation`, `attestationsOf`). Deployed on Base Sepolia; tests drive the real
  verifier with a real proof fixture.
- **Oracle & AI:** Python (earthengine-api, rasterio, numpy, scikit-learn) and Node (circomlibjs for bit-identical
  Poseidon hashes, viem for publishing). Hansen v1.12 `lossyear` 2021+ marks a cell as loss; the RandomForest can only
  *remove* clean cells (`final = hansen ∧ ai`); disagreements go to a human review queue.
- **Frontend:** Vite + React + TypeScript, wagmi + viem, react-leaflet, snarkjs in the browser, poseidon-lite for
  client-side Merkle paths with a 256-node checkpoint so a phone needs ~500 hashes instead of 65 000.
- **Anomaly monitor:** plain JSON-RPC log extraction + scikit-learn IsolationForest → `risk.json`.

## Challenges we ran into

- Making Poseidon hashes identical across circom, Node (circomlibjs) and the browser (poseidon-lite) — pinned by tests
  that recompute the published root from the shipped data.
- Public RPC quirks: `eth_getLogs` block-range limits (solved with recursive range splitting) and load-balanced nodes
  lagging a block behind each other right after a transaction (solved with retries).
- Google Earth Engine tags Hansen's `lossyear = 0` ("no loss") as nodata; honouring it would have labelled 92 % of cells
  as deforested. Caught before publishing, now covered by a regression test.
- Keeping the ZK artefacts honest: the zkey is never committed; the frontend syncs it from the circuit build or a URL.

## Accomplishments that we're proud of

- End-to-end privacy-preserving EUDR attestation on a public testnet with real satellite data — 31 attestations so far,
  every one a genuine proof.
- A negative path that actually works: a loss cell cannot produce a proof at all, and a second claim on the same cell is
  rejected by the contract with `NullifierAlreadyUsed` before any gas is spent.
- Two AI components with a clear role each: quality control on satellite labels, and pattern surveillance on the chain.

## What we learned

Zero-knowledge proofs are only as trustworthy as the data they prove against — so we spent as much effort on labelling
provenance (metadata hashes on-chain, review queues, honest metrics) as on the circuit. A weak signal reported honestly
(F1 0.22 for partial-cell clearing from annual NDVI) is more useful to a regulator than an inflated one.

## What's next for ZKanopy

Polygon plots with the EUDR 128 m buffer, a multi-attestor (threshold) oracle instead of a single publisher, a
multi-party trusted setup, TRACES API integration for real DDS filing, proof of land legality, and a mainnet deployment
after an audit. See the roadmap in the README.

## Built with

circom · snarkjs · circomlib · Solidity · Foundry · Base (Sepolia) · viem · wagmi · React · Vite · TypeScript ·
Leaflet · Esri World Imagery · GSAP · Google Earth Engine · Hansen Global Forest Change · Sentinel-2 · Python ·
scikit-learn · rasterio · numpy · poseidon-lite · Vercel

## Links

- Repository: https://github.com/MrPrinceAli/zkanopy
- Live demo: `TODO https://<project>.vercel.app`
- Video (3–5 min): `TODO`
- Registry contract: https://sepolia.basescan.org/address/0xd5569a4557E4CaE10464Ff868f6A3594014D852f
- First attestation: https://sepolia.basescan.org/tx/0xeb4824de2e95a8a601e667a64a431bbb769da5bf82f5287a37923cbf047706df
