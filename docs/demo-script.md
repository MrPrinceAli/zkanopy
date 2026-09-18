# Demo video script (3–5 minutes)

Target length 4:15. Record at 1080p with the browser at ~1100 px wide so the single-column layout fills the frame.
Keep the Basescan tab, the repo and `oracle/out/ai_report.md` open in advance. Mute wallet pop-up sounds.

## Before recording

```bash
cd frontend && npm run dev            # http://localhost:5173 (or use the Vercel URL)
```

- Wallet: MetaMask on **Base Sepolia** with the project wallet imported (`PRIVATE_KEY` in `.env`,
  `0x9584D49c674F685D6CD3463D9beBCfF3d8b68923`, ≈0.04 ETH) — it is the exporter for the demo.
- Fresh clean cells (not yet attested) near Takengon, with centre coordinates you can paste into the map search or
  simply click at zoom 16:
  - **(100,101)** 4.640450 N, 96.841350 E — main success demo
  - (101,100) 4.641350 N, 96.840450 E — spare
  - (98,98) 4.638650 N, 96.838650 E — spare
- Loss cell: **(105,90)** 4.644950 N, 96.831450 E (red in the overlay).
- Already-attested cell for the double-claim demo: **(100,100)** 4.640536 N, 96.840448 E (attestation #1).
- Open DevTools → Network on the `/farmer` tab, filter "Fetch/XHR", clear it just before generating the proof.

## 0:00–0:30 · The problem

Slide or spoken over the map:

> "EUDR: every plot behind a shipment of cocoa, coffee, palm oil or rubber must be geolocated and checked against a
> 31 December 2020 deforestation cut-off. Today smallholders hand raw coordinates to a central platform — a
> data-sovereignty risk — and the same plot can be sold to several exporters. ZKanopy lets a farmer *prove* the plot is
> clean without revealing where it is, and makes double-selling impossible."

## 0:30–1:00 · Architecture

Show `docs/architecture.png`. Point at the four boxes:

> "An oracle turns Hansen and Sentinel-2 data into a grid of clean/loss cells — with a RandomForest quality check — and
> publishes only a Merkle root on Base. The farmer's browser builds a zero-knowledge proof that their cell is clean. The
> contract verifies it, records a nullifier, and the exporter gets an attestation. A second AI watches the on-chain claim
> log for suspicious patterns."

## 1:00–2:00 · Farmer: clean plot → proof → transaction

1. `/farmer`: note the green **"matches on-chain root"** pill — the browser verified the grid against the chain.
2. Tick **Show cells flagged as loss** — red cells appear. Zoom to Takengon (zoom 16).
3. Click cell **(100,101)** → "row 100, col 101 · clean". Say: *"the coordinates stay on this device"*.
4. Commodity: Coffee. **Generate proof** → "Proof generated in ~500 ms". Open the public-signals panel:
   *"seven numbers: nullifier, root, season, exporter and grid parameters — no latitude, no longitude."*
5. Switch to the Network tab: *"the only requests are the public grid files, the proving key, and the RPC call — nothing
   with my coordinates left the browser."*
6. **Submit attestation** → confirm in the wallet → "Attestation #32 recorded" (id may differ) → click the tx link →
   Basescan shows `attest` with the same seven public signals.

## 2:00–2:30 · The two negative paths

1. Click the red cell **(105,90)** → status **loss**, message *"This cell was flagged as deforested after 2020 (Hansen GFC +
   AI QC). A proof cannot be generated for it."* — the button is disabled; there is no witness for a loss leaf.
2. Click **(100,100)** (attested earlier) → Generate proof works (it is a clean cell) → **Submit** →
   `NullifierAlreadyUsed — This cell has already been attested for this season`. Say: *"the contract rejected it during
   simulation, so it cost no gas; on-chain the same revert happens."*

## 2:30–3:15 · Exporter and public verification

1. `/exporter` (wallet connected): the table lists the attestations for this address with season, commodity, nullifier,
   time and explorer links.
2. Select the rows → **Export DDS JSON** → open the file: `zkanopy-dds/v1`, operator, commodity HS code, season, one entry
   per attestation with nullifier, grid root and the statement *"coordinates withheld by design"*.
3. Open `/verify/1` in a fresh private window (no wallet): attestation, grid version, root, metadata hash, tx link.

## 3:15–3:45 · The AI modules

1. Show `oracle/out/ai_report.md`: 40 000 cells, RandomForest on NDVI features, honest metrics (F1 loss 0.22 — annual
   NDVI is a weak signal), 2 266 disagreements in `review_queue.csv`, and the conservative rule `final = hansen ∧ ai`.
2. `/regulator`: four exporters; the rogue wallet `0x0db5…49f0` at risk **1.00** — 25 claims in one hour, 100 % within
   5 minutes. *"The blockchain guarantees the AI's input; the AI watches the blockchain."*

## 3:45–4:15 · Roadmap and close

> "Next: polygon plots with the 128 m buffer, a threshold oracle instead of a single publisher, a multi-party trusted
> setup, TRACES API integration, and proof of land legality. Everything you saw runs on Base Sepolia today — the repo has a
> one-command reproduction for each stage."

End card: repo URL · live demo URL · Registry address.
