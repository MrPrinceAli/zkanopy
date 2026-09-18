# PRD — ZKanopy: Bukti Bebas-Deforestasi Zero-Knowledge untuk Petani Kecil

> **Status:** Draft v1 · **Target:** IEEE ClimateChain Global Hackathon (Devpost, 5–25 Okt 2026) · **Track:** Sustainable Supply Chains · **Tim:** 1 orang (solo) · **Nama proyek:** *ZKanopy* (placeholder, boleh diganti)

---

## 0. Cara memakai dokumen ini dengan AI coding agent

1. Taruh file ini di root repo sebagai `PRD.md`. Buat juga `CLAUDE.md` / `.cursorrules` yang berisi satu baris: *"Baca PRD.md sebelum mengerjakan apa pun. Kerjakan per fase (Bagian 10). Jangan lanjut ke fase berikutnya sebelum Definition of Done fase saat ini terpenuhi."*
2. Minta agent mengerjakan **satu fase per sesi**. Contoh prompt: *"Kerjakan Fase 1 sesuai PRD.md. Setelah selesai, jalankan tes dan laporkan hasilnya."*
3. Aturan keras untuk agent (Bagian 12) tidak boleh dilanggar tanpa persetujuan eksplisit.

---

## 1. Ringkasan produk

**Satu kalimat:** Petani kecil membuktikan secara kriptografis bahwa plot lahannya *tidak mengalami deforestasi setelah 31 Desember 2020* (cut-off EUDR) **tanpa mengungkap koordinat lahannya**, dan bukti itu diverifikasi on-chain menjadi attestation yang bisa dipakai eksportir untuk menyusun Due Diligence Statement (DDS).

**Masalah yang diselesaikan**

| Masalah | Dampak hari ini |
|---|---|
| EUDR mewajibkan geolokasi tiap plot + verifikasi satelit terhadap cut-off 2020; tanpa itu komoditas tidak bisa masuk pasar EU. | Petani kecil (sawit, kopi, kakao, karet) berisiko terputus dari pasar. |
| Platform traceability yang ada bersifat terpusat: petani harus menyerahkan koordinat mentah ke platform. | Kekhawatiran kedaulatan data (land-grabbing, kompetitor, penyalahgunaan). |
| Satu plot bisa "dijual" ke beberapa eksportir sekaligus (double-selling). | Integritas DDS lemah. |

**Solusi:** grid deforestasi (label per sel) dari data satelit → Merkle root on-chain → petani membuat zk-SNARK bahwa selnya berlabel *clean* → smart contract memverifikasi, mencatat **nullifier** (anti double-selling), dan menerbitkan attestation → eksportir mengekspor DDS JSON.

---

## 2. Tujuan & bukan-tujuan

**Tujuan (MVP hackathon)**
- G1. Demo end-to-end berjalan di testnet: pilih titik → proof di browser → tx → attestation tercatat → DDS JSON terunduh.
- G2. Kasus negatif terdemonstrasi: (a) plot berlabel *loss* → proof gagal dibuat; (b) plot yang sama diklaim dua kali di musim yang sama → tx revert `NullifierAlreadyUsed`.
- G3. Ada komponen AI yang nyata dan berguna (modul QC label deforestasi).
- G4. Repo publik dengan README, diagram arsitektur, dan skrip reproduksi.
- G5. Video demo 3–5 menit.

**Bukan-tujuan (sebutkan sebagai roadmap di pitch)**
- Poligon multi-sel dan buffer 128 m (MVP hanya satu titik = satu sel).
- Bukti legalitas lahan / hak atas tanah.
- Oracle terdesentralisasi (threshold signature).
- Integrasi API TRACES sungguhan.
- Deployment mainnet, audit keamanan, gas optimization.

---

## 3. Pengguna & user stories

| Persona | Kebutuhan |
|---|---|
| **Petani / koperasi** | Membuktikan plot bebas-deforestasi tanpa menyerahkan koordinat. |
| **Eksportir / operator EU** | Mengumpulkan attestation dari banyak petani menjadi satu batch dan mengekspor DDS. |
| **Regulator / verifier** | Mengecek attestation di chain dan melihat root/grid versi mana yang dipakai. |

- US1. Sebagai petani, saya klik titik plot di peta, sistem menghasilkan proof di browser saya, dan koordinat tidak pernah meninggalkan perangkat.
- US2. Sebagai petani, jika plot saya berada di sel *loss*, sistem memberi tahu proof tidak bisa dibuat dan alasannya.
- US3. Sebagai eksportir, saya melihat daftar attestation yang ditujukan ke alamat saya dan mengunduh DDS JSON.
- US4. Sebagai regulator, saya membuka `/verify/:id` dan melihat attestation, root, versi grid, dan tautan block explorer.
- US5. Sebagai siapa pun, saya melihat bahwa upaya klaim ganda ditolak oleh contract.

---

## 4. Arsitektur

```
┌──────────────────────────┐        ┌───────────────────────────┐
│  A. Oracle Geospasial    │        │  C. Smart Contract        │
│  (Python + Node, offline)│        │  (Solidity, testnet)      │
│  Hansen GFC + Sentinel-2 │        │  Groth16Verifier.sol      │
│  → grid sel clean/loss   │──root─▶│  Registry.sol             │
│  → AI QC (RandomForest)  │        │   - registerRoot          │
│  → Merkle tree (Poseidon)│        │   - attest (verify+null.) │
└──────────────────────────┘        └─────────────▲─────────────┘
              │ tree.json (leaves)                │ proof + public signals
              ▼                                   │
┌──────────────────────────┐        ┌─────────────┴─────────────┐
│  B. Prover (browser)     │        │  D. Frontend (React)      │
│  circuit .wasm + .zkey   │◀──────▶│  /farmer /exporter        │
│  snarkjs groth16         │        │  /verify/:id              │
└──────────────────────────┘        └───────────────────────────┘
```

**Alur data**
1. Oracle membangun grid untuk satu AOI, memberi label tiap sel, membangun Merkle tree, dan mem-publish `root` + parameter grid ke `Registry.sol`.
2. Frontend mengunduh `tree.json` (seluruh daun) agar pengambilan Merkle path terjadi **di sisi klien** — server tidak pernah tahu sel mana yang diminta.
3. Petani memilih titik → frontend menghitung `(row, col)`, mengambil path, menjalankan `groth16.fullProve`.
4. Frontend mengirim `attest(proof, publicSignals, commodityHash)`.
5. Contract memverifikasi proof, memastikan `root` terdaftar dan `nullifier` belum dipakai, menyimpan attestation, emit event.
6. Halaman eksportir membaca event dan menyusun DDS JSON.

---

## 5. Spesifikasi teknis

### 5.1 Tech stack (kunci, jangan diganti tanpa alasan)

| Lapisan | Pilihan |
|---|---|
| Circuit | Circom 2.1.x, circomlib (Poseidon, comparators), snarkjs (Groth16), Powers of Tau `pot16_final.ptau` |
| Contract | Solidity ^0.8.24, Foundry (forge/cast/anvil) |
| Chain | Base Sepolia (fallback: Ethereum Sepolia) |
| Data | Google Earth Engine Python API, rasterio, numpy, geopandas |
| AI | scikit-learn RandomForestClassifier |
| Merkle build | Node.js + circomlibjs (agar hash identik dengan circuit) |
| Frontend | Vite + React + TypeScript, wagmi + viem, Leaflet (react-leaflet), snarkjs (browser) |
| Hosting | Vercel (frontend), file wasm/zkey/tree.json di `public/` |

### 5.2 Representasi koordinat & grid

- Koordinat dikonversi ke integer fixed-point non-negatif:
  - `latS = round((lat + 90) * 1e6)`, `lonS = round((lon + 180) * 1e6)`. Rentang ≤ 3.6e8 → aman di 64 bit.
- Grid persegi lat/lon sederhana (bukan H3):
  - Parameter publik: `lat0S`, `lon0S` (pojok kiri-bawah AOI, fixed-point), `stepS` (ukuran sel, fixed-point; default `900` ≈ 100 m di ekuator).
  - `row = floor((latS - lat0S) / stepS)`, `col = floor((lonS - lon0S) / stepS)`.
  - AOI MVP: bbox kecil ~20×20 km → maks. ~200×200 = 40.000 sel → Merkle depth **16** (65.536 daun).
- Label sel: `1 = clean`, `0 = loss`. Sel = *loss* jika ada piksel Hansen `lossyear ∈ {21..25}` di dalamnya (deforestasi 2021–2025). Kalau pipeline pakai versi Hansen lebih baru, perluas rentang tahunnya.
- Indeks daun Merkle: `leafIndex = row * COLS + col` (COLS = jumlah kolom grid, dipublikasikan bersama root). Daun kosong di luar grid diisi `Poseidon(0,0,0)`.

### 5.3 Spesifikasi circuit — `circuits/deforestation_free.circom`

```
template DeforestationFree(depth) {
    // ---- input privat ----
    signal input latS;               // fixed-point
    signal input lonS;
    signal input row;
    signal input col;
    signal input pathElements[depth];
    signal input pathIndices[depth]; // 0/1

    // ---- input publik ----
    signal input root;
    signal input season;             // mis. 2026
    signal input exporter;           // alamat eksportir sebagai field element
    signal input lat0S;
    signal input lon0S;
    signal input stepS;

    // ---- output publik ----
    signal output nullifier;
```

Constraint yang **wajib** ada:
1. **Range check sel:** `lat0S + row*stepS <= latS < lat0S + (row+1)*stepS`, sama untuk `lon/col`. Gunakan `LessThan(64)` / `LessEqThan(64)` dari circomlib. Semua sinyal yang dibandingkan dipastikan < 2^64 (pakai `Num2Bits(64)`).
2. **Daun:** `leaf = Poseidon(3)([row, col, 1])` — konstanta `1` berarti hanya daun *clean* yang bisa dibuktikan.
3. **Merkle membership:** hitung root dari `leaf`, `pathElements`, `pathIndices` dengan `Poseidon(2)` (pola `MerkleTreeChecker` ala Tornado/Semaphore); constrain `computedRoot === root`.
4. **Nullifier:** `nullifier <== Poseidon(3)([row, col, season])`.
5. **Binding exporter** (mencegah proof dicuri dari mempool dan dipakai orang lain): `signal exporterSq <== exporter * exporter;`.

Urutan **public signals** hasil snarkjs (harus konsisten di contract & frontend): `[nullifier, root, season, exporter, lat0S, lon0S, stepS]` (output dulu, lalu input publik sesuai urutan deklarasi). **Jangan ubah urutan ini setelah Fase 1 selesai.**

Artefak build: `build/deforestation_free.wasm`, `build/deforestation_free_final.zkey`, `build/verification_key.json`, `contracts/src/Groth16Verifier.sol`.

Skrip build (`circuits/build.sh`): compile → witness test → `groth16 setup` dengan ptau → contribute (1 kontribusi dummy cukup untuk hackathon) → export verifier Solidity + vkey.

### 5.4 Spesifikasi contract — `contracts/src/Registry.sol`

```solidity
struct Grid {
    uint256 root;
    uint64  lat0S;
    uint64  lon0S;
    uint64  stepS;
    uint32  cols;
    uint32  rows;
    uint32  version;
    uint64  publishedAt;
    string  metadataURI;   // IPFS/URL ke deskripsi dataset, model AI, hash tree.json
}

struct Attestation {
    uint256 id;
    address exporter;
    uint256 gridId;
    uint256 nullifier;
    uint32  season;
    bytes32 commodityHash; // keccak256(kode HS + deskripsi komoditas)
    uint64  timestamp;
}
```

Fungsi:
- `registerRoot(Grid calldata g) external onlyOracle returns (uint256 gridId)` — emit `RootRegistered`.
- `attest(uint[2] a, uint[2][2] b, uint[2] c, uint[7] pubSignals, uint256 gridId, bytes32 commodityHash) external returns (uint256 id)`:
  1. `pubSignals[1] == grids[gridId].root`, `pubSignals[4..6]` == parameter grid → jika tidak: `revert UnknownRootOrGrid()`.
  2. `pubSignals[3] == uint256(uint160(msg.sender))` → jika tidak: `revert ExporterMismatch()`. (Eksportir yang mengirim tx; atau petani mengirim atas nama eksportir — pilih satu dan konsisten. **Default MVP:** tx dikirim dari wallet eksportir setelah menerima proof dari petani; untuk demo boleh satu wallet memainkan dua peran.)
  3. `verifier.verifyProof(a,b,c,pubSignals)` → jika false: `revert InvalidProof()`.
  4. `!nullifierUsed[pubSignals[0]]` → jika sudah: `revert NullifierAlreadyUsed()`.
  5. Simpan, emit `Attested(id, exporter, gridId, nullifier, season, commodityHash)`.
- `getAttestation(uint256 id) view`, `attestationsOf(address exporter) view returns (uint256[])`.
- `oracle` = alamat deployer; `setOracle` onlyOwner.

Tes Foundry wajib (`contracts/test/Registry.t.sol`):
- `test_attest_success` (pakai proof fixture dari Fase 1 di `contracts/test/fixtures/proof_ok.json`).
- `test_revert_nullifier_reuse`.
- `test_revert_invalid_proof` (ubah satu byte).
- `test_revert_unknown_root`.

### 5.5 Pipeline data & AI — `oracle/`

`oracle/01_export_gee.py`
- Input: `config.yaml` (bbox AOI, tahun, nama). Default AOI: area kakao/kopi di Sulawesi atau Aceh — pilih satu, catat di README.
- Output GeoTIFF ke `oracle/data/`: `hansen_lossyear.tif`, `ndvi_2020.tif`, `ndvi_2025.tif` (median komposit Sentinel-2 SR, cloud-masked, band NDVI), resolusi 30 m, CRS EPSG:4326.

`oracle/02_build_grid.py`
- Baca raster, bangun grid `stepS`, hitung per sel: `frac_loss` (fraksi piksel lossyear 21–25), `ndvi_2020_mean`, `ndvi_2025_mean`, `dndvi = ndvi_2025 - ndvi_2020`.
- Label Hansen: `hansen_label = 0 if frac_loss > 0 else 1`.
- Output: `oracle/out/cells.csv` dengan kolom `row,col,frac_loss,ndvi_2020,ndvi_2025,dndvi,hansen_label`.

`oracle/03_ai_qc.py` (**komponen AI**)
- Latih `RandomForestClassifier` dengan fitur `[ndvi_2020, ndvi_2025, dndvi]`, label `hansen_label`, split 80/20, laporkan accuracy/F1 dan feature importance ke `oracle/out/ai_report.md`.
- Prediksi semua sel → `ai_label`, `ai_prob`.
- `disagreement = (ai_label != hansen_label)`.
- **Label final** yang masuk Merkle tree: `final_label = 1` hanya jika `hansen_label == 1` **dan** `ai_label == 1` (konservatif: keduanya harus sepakat sel bersih). Sel `disagreement` dicatat di `oracle/out/review_queue.csv` untuk tinjauan manusia.
- Output: `oracle/out/cells_final.csv`.

`oracle/04_build_merkle.js`
- Baca `cells_final.csv`, hitung `leaf = poseidon([row, col, final_label])` dengan circomlibjs, susun tree depth 16 dengan `leafIndex = row*cols + col`, daun kosong `poseidon([0,0,0])`.
- Output: `frontend/public/data/tree.json` `{ depth, cols, rows, lat0S, lon0S, stepS, root, leaves: [...] }` dan `oracle/out/root.json`. Sertakan `sha256(tree.json)` untuk dimasukkan ke `metadataURI`.
- Sediakan fungsi `getPath(tree, leafIndex)` yang dipakai ulang oleh frontend (taruh di `packages/merkle/` atau salin ke `frontend/src/lib/merkle.ts`).

`oracle/05_publish_root.js`
- Panggil `registerRoot` di testnet lewat viem/ethers dengan private key dari `.env`.

### 5.6 Frontend — `frontend/`

Halaman:

**`/farmer`**
1. Peta Leaflet dengan overlay batas AOI dan (opsional) heat overlay sel *loss* untuk keperluan demo.
2. Klik titik → tampilkan `(row, col)`, status sel (`clean`/`loss`) dari `tree.json` **di klien**.
3. Form: pilih eksportir (alamat), musim (`season`), komoditas (dropdown: kakao/kopi/sawit/karet → `commodityHash`).
4. Tombol **Generate Proof** → `snarkjs.groth16.fullProve(input, wasm, zkey)`; tampilkan waktu proving; simpan `proof.json` yang bisa diunduh/di-copy.
5. Jika sel `loss`: tombol dinonaktifkan dengan pesan "Sel ini terdeteksi mengalami deforestasi pasca-2020 (Hansen + AI QC). Proof tidak dapat dibuat."
6. Tombol **Submit Attestation** → kirim tx `attest` (untuk demo, wallet yang sama boleh bertindak sebagai eksportir). Tampilkan hash tx + link explorer. Tangani revert dan tampilkan nama error (`NullifierAlreadyUsed`, dll.).
7. Indikator privasi: "Koordinat tidak pernah dikirim ke server maupun chain."

**`/exporter`**
1. Connect wallet → baca event `Attested` untuk alamat ini (viem `getLogs`).
2. Tabel attestation: id, season, komoditas, nullifier (dipersingkat), waktu, link explorer.
3. Pilih beberapa → **Export DDS JSON** (skema di 5.7) → unduh file.

**`/verify/:id`**
- Tampilkan attestation, grid (versi, root, `metadataURI`), dan tautan tx. Tidak butuh wallet.

**`/regulator`** (komponen AI #2 — deteksi anomali klaim on-chain)
1. Skrip `oracle/06_claim_anomaly.py`: tarik semua event `Attested` dari chain (viem/web3.py), bentuk fitur per eksportir: jumlah klaim, klaim per jam (burst), jumlah eksportir berbeda yang mengklaim di musim yang sama, dan rasio klaim yang berdekatan waktu. Jalankan `IsolationForest` → `risk_score` per eksportir → tulis `frontend/public/data/risk.json`.
2. Halaman menampilkan tabel eksportir + `risk_score` + alasan (fitur yang menonjol). Tidak butuh wallet.
3. Untuk demo, buat satu wallet "nakal" yang mengirim 20+ attestation dalam beberapa menit agar skornya terlihat tinggi.
4. Narasi pitch: *AI mengawasi blockchain (pola klaim), blockchain menjamin AI (data input tidak bisa dimanipulasi).*

Non-fungsional:
- Proof harus selesai < 30 detik di laptop biasa (depth 16 Groth16 seharusnya < 5 detik).
- `tree.json` ≤ 10 MB; di-load sekali, di-cache di memori.
- Mobile-friendly (petani memakai HP) — layout satu kolom.

### 5.7 Skema DDS JSON (ekspor eksportir)

```json
{
  "schema": "zkanopy-dds/v1",
  "operator": { "address": "0x...", "eori": "PLACEHOLDER" },
  "commodity": { "hsCode": "1801", "description": "Cocoa beans" },
  "season": 2026,
  "attestations": [
    {
      "id": 12,
      "chainId": 84532,
      "contract": "0x...",
      "txHash": "0x...",
      "nullifier": "0x...",
      "grid": { "id": 1, "version": 1, "root": "0x...", "metadataURI": "ipfs://..." },
      "statement": "Plot verified deforestation-free after 2020-12-31 via zero-knowledge proof; coordinates withheld by design."
    }
  ],
  "generatedAt": "2026-10-20T10:00:00Z"
}
```

Catatan untuk README: format ini adalah *pemetaan konseptual* ke field DDS TRACES, bukan format resmi.

---

## 6. Struktur repo

```
zkanopy/
├── PRD.md
├── README.md
├── CLAUDE.md
├── circuits/
│   ├── deforestation_free.circom
│   ├── build.sh
│   ├── test/            # input contoh + tes witness (mocha)
│   └── build/           # (gitignore: zkey besar; commit wasm + vkey)
├── contracts/           # Foundry
│   ├── src/Registry.sol
│   ├── src/Groth16Verifier.sol   # generated
│   ├── test/Registry.t.sol
│   ├── test/fixtures/
│   └── script/Deploy.s.sol
├── oracle/
│   ├── config.yaml
│   ├── 01_export_gee.py
│   ├── 02_build_grid.py
│   ├── 03_ai_qc.py
│   ├── 04_build_merkle.js
│   ├── 05_publish_root.js
│   ├── requirements.txt
│   └── out/
├── frontend/            # Vite + React + TS
│   ├── public/zk/       # .wasm, .zkey
│   ├── public/data/tree.json
│   └── src/
│       ├── pages/{Farmer,Exporter,Verify}.tsx
│       ├── lib/{merkle.ts,prover.ts,contract.ts,dds.ts}
│       └── config.ts    # alamat contract, chain, grid params
└── docs/
    ├── architecture.png
    └── demo-script.md
```

---

## 7. Keputusan desain (agar agent tidak berdebat ulang)

| Keputusan | Alasan |
|---|---|
| Groth16, bukan PLONK | Verifier paling murah gas, tooling snarkjs paling matang. Trusted setup per-circuit diterima untuk hackathon. |
| Grid lat/lon, bukan H3 | Perhitungan sel bisa dicek di circuit dengan aritmetika integer sederhana. |
| Prover menyuplai `row/col` sebagai witness + circuit cek range | Menghindari pembagian di circuit. |
| Seluruh `tree.json` diunduh ke klien | Path diambil lokal → server tidak belajar sel mana yang diminta. |
| Nullifier = hash(row, col, season) | Satu sel hanya bisa di-attest sekali per musim; cukup untuk mencegah double-selling di MVP. Edge case (satu plot menjual sebagian ke dua eksportir) masuk roadmap. |
| Label final = Hansen ∧ AI | Konservatif; AI berperan sebagai QC, bukan pengganti data resmi. |
| `exporter` sebagai public input | Proof terikat ke satu eksportir; tidak bisa dipakai ulang oleh pihak lain. |

---

## 8. Keamanan & privasi (untuk pitch dan README)

- Koordinat tidak pernah meninggalkan perangkat petani; yang publik hanya `root, nullifier, season, exporter, parameter grid`.
- Nullifier tidak mengungkap sel (preimage-resistant Poseidon), tetapi dua klaim pada sel yang sama di musim yang sama terdeteksi.
- Ancaman yang **belum** ditangani (jujur di pitch): oracle tunggal bisa memasang root palsu → roadmap threshold attestor; korelasi timing antara unduhan `tree.json` dan tx; ketepatan GPS petani.

---

## 9. Kriteria penerimaan (Definition of Done proyek)

- [ ] `circuits/build.sh` menghasilkan wasm/zkey/vkey/verifier tanpa error; tes witness lolos untuk kasus clean dan gagal untuk kasus loss.
- [ ] `forge test` hijau (4 tes di 5.4).
- [ ] Contract ter-deploy di Base Sepolia; alamat dicatat di `frontend/src/config.ts` dan README.
- [ ] Oracle pipeline berjalan dari `config.yaml` sampai `tree.json` + root terdaftar on-chain; `ai_report.md` berisi metrik model.
- [ ] `/farmer`: proof dibuat di browser (< 30 s), tx sukses, link explorer tampil.
- [ ] `/farmer`: klaim kedua pada titik yang sama → UI menampilkan `NullifierAlreadyUsed`.
- [ ] `/farmer`: titik di sel loss → proof diblokir dengan pesan yang jelas.
- [ ] `/exporter`: daftar attestation muncul; DDS JSON terunduh sesuai skema 5.7.
- [ ] `/verify/:id` berfungsi tanpa wallet.
- [ ] `/regulator`: skor anomali per eksportir tampil, dihitung dari event on-chain; wallet demo "nakal" terdeteksi.
- [ ] README: cara reproduksi lengkap, diagram arsitektur, tabel perbandingan vs solusi terpusat, roadmap.
- [ ] Video 3–5 menit terunggah; halaman Devpost lengkap; submit paling lambat **24 Okt 2026**.

---

## 10. Rencana fase (solo, ±60–80 jam)

| Fase | Isi | Definition of Done | Estimasi |
|---|---|---|---|
| **0. Setup** (sebelum 5 Okt) | Akun GEE, Devpost, wallet, RPC, faucet; install circom/snarkjs/foundry; repo + struktur folder; unduh ptau. Belajar tutorial Merkle membership Circom. | Semua tool `--version` jalan; repo terinisialisasi. | 4–6 j |
| **1. Circuit** | Tulis circuit 5.3, build.sh, tes witness (clean lolos, loss gagal, row salah gagal). Simpan `proof_ok.json` sebagai fixture. | `build.sh` sukses; `snarkjs groth16 verify` = OK. | 12–15 j |
| **2. Contract** | `Registry.sol`, tes 5.4, `Deploy.s.sol`, deploy Base Sepolia. | `forge test` hijau; alamat contract tercatat. | 6–8 j |
| **3. Oracle & AI** | Skrip 01–05, jalankan untuk AOI pilihan, publish root. Kalau GEE belum di-approve: gunakan **dataset sintetis** (grid acak dengan ~10% loss) agar fase lain tidak terblokir, lalu ganti dengan data asli. | `tree.json` ada; root on-chain; `ai_report.md` ada. | 8–10 j |
| **4. Frontend petani** | `/farmer` lengkap termasuk proof di browser dan submit tx. | US1, US2, US5 terdemonstrasi. | 10–12 j |
| **5. Frontend eksportir, verify & regulator** | `/exporter`, `/verify/:id`, ekspor DDS, `06_claim_anomaly.py` + `/regulator`. | US3, US4 terdemonstrasi; `risk.json` terbentuk dari event on-chain dan wallet "nakal" muncul dengan skor tinggi. | 9–12 j |
| **6. Polish & submit** | README, diagram, demo script, rekam video, halaman Devpost. | Semua kotak Bagian 9 tercentang. | 8–10 j |

**Aturan penurunan scope kalau terlambat:** (1) hapus range-check koordinat di circuit (sisakan Merkle + nullifier); (2) ganti overlay peta dengan input `(row, col)` manual; (3) AI QC cukup dilaporkan di notebook tanpa mengubah label final.

---

## 11. Skrip demo video (3–5 menit)

1. **0:00–0:30** Masalah: EUDR, petani kecil, kedaulatan data, double-selling.
2. **0:30–1:00** Arsitektur 4 kotak (Bagian 4) + di mana AI dan ZK berperan.
3. **1:00–2:00** Demo petani: klik titik clean → proof (tunjukkan timer) → tx → explorer. Tunjukkan Network tab: tidak ada koordinat yang terkirim.
4. **2:00–2:30** Klik titik loss → proof diblokir. Ulangi titik clean yang sama → `NullifierAlreadyUsed`.
5. **2:30–3:15** Demo eksportir: daftar attestation → export DDS JSON. Halaman verify.
6. **3:15–3:45** Modul AI: tampilkan `ai_report.md`, review queue.
7. **3:45–4:15** Roadmap: poligon + buffer, threshold oracle, integrasi TRACES, bukti legalitas.

---

## 12. Aturan keras untuk AI coding agent

1. Jangan mengubah urutan public signals (5.3), skema `Grid`/`Attestation`, atau nama error contract setelah Fase 1–2 selesai.
2. Jangan mengganti stack (5.1) tanpa menyebut alasan dan meminta persetujuan.
3. Setiap fase harus diakhiri dengan perintah tes yang benar-benar dijalankan (`bash circuits/build.sh`, `forge test`, `npm test`, `python -m pytest`) dan hasilnya dilaporkan apa adanya.
4. Rahasia (`PRIVATE_KEY`, kredensial GEE) hanya di `.env`, dan `.env` ada di `.gitignore`. Jangan pernah commit zkey final yang besar; commit wasm + vkey + verifier.
5. Kalau ada yang ambigu, pilih opsi yang **paling sederhana** yang tetap memenuhi Definition of Done, lalu catat keputusannya di `docs/decisions.md`.
6. Tulis kode dan komentar dalam bahasa Inggris; README dalam bahasa Inggris (juri internasional).
7. Jangan menambahkan fitur di luar Bagian 2 "Tujuan" tanpa diminta.

---

## 13. Glosarium singkat

- **EUDR** — EU Deforestation Regulation (2023/1115); komoditas ke EU harus bebas-deforestasi setelah 31 Des 2020 dan tertelusur ke plot.
- **DDS** — Due Diligence Statement, pernyataan yang diunggah operator ke sistem TRACES.
- **Hansen GFC** — Global Forest Change, dataset kehilangan tutupan pohon tahunan 30 m.
- **Nullifier** — nilai publik turunan rahasia yang mencegah bukti yang sama dipakai dua kali tanpa mengungkap rahasianya.
- **Groth16** — skema zk-SNARK dengan proof kecil dan verifikasi murah, butuh trusted setup per circuit.
