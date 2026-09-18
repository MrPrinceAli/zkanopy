// /farmer — pick a plot on the map, prove it sits in a clean cell, submit the attestation (PRD 5.6).
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, type Address } from "viem";
import AoiMap from "../components/AoiMap";
import { loadGridData, type GridData } from "../lib/data";
import { cellOf, checkpointRoot, getPath, isClean, type CellHit } from "../lib/merkle";
import { generateProof, proofFileContents, type ProofResult } from "../lib/prover";
import {
  ATTEST_GAS_LIMIT,
  COMMODITIES,
  REGISTRY_ABI,
  commodityHash,
  decodeContractError,
  shortHex,
  txUrl,
  type DecodedError,
} from "../lib/contract";
import { REGISTRY_ADDRESS } from "../config";

type DataState =
  | { status: "loading" }
  | { status: "ready"; data: GridData; onchainRoot: bigint | null; verified: boolean }
  | { status: "error"; message: string };

type SubmitState =
  | { status: "idle" }
  | { status: "simulating" }
  | { status: "pending"; hash: `0x${string}` }
  | { status: "success"; hash: `0x${string}`; id: bigint | null }
  | { status: "error"; error: DecodedError; hash?: `0x${string}` };

const LOSS_MESSAGE =
  "This cell was flagged as deforested after 2020 (Hansen GFC + AI QC). A proof cannot be generated for it.";

export default function Farmer() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [data, setData] = useState<DataState>({ status: "loading" });
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [showLoss, setShowLoss] = useState(false);

  const [exporter, setExporter] = useState("");
  const [season, setSeason] = useState(2026);
  const [commodityKey, setCommodityKey] = useState(COMMODITIES[0].key);

  const [proving, setProving] = useState(false);
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [proveError, setProveError] = useState<string | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  // Load tree.json / checkpoint.json / grid.json once, then verify the checkpoint against the on-chain root.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadGridData();
        const cpRoot = checkpointRoot(d.checkpoint, BigInt(d.tree.zeroLeaf));
        if (cpRoot.toString() !== d.tree.root) throw new Error("checkpoint.json does not match tree.json");
        let onchainRoot: bigint | null = null;
        try {
          const g = await publicClient!.readContract({
            address: REGISTRY_ADDRESS,
            abi: REGISTRY_ABI,
            functionName: "getGrid",
            args: [BigInt(d.record.gridId)],
          });
          onchainRoot = g.root;
        } catch {
          onchainRoot = null; // RPC hiccup: still usable, just unverified
        }
        if (!cancelled) {
          setData({ status: "ready", data: d, onchainRoot, verified: onchainRoot !== null && onchainRoot.toString() === d.tree.root });
        }
      } catch (e) {
        if (!cancelled) setData({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  // Default the exporter to the connected wallet (demo: one wallet plays both roles).
  useEffect(() => {
    if (address && !exporter) setExporter(address);
  }, [address, exporter]);

  const cell: CellHit | null = useMemo(() => {
    if (!point || data.status !== "ready") return null;
    return cellOf(point.lat, point.lon, data.data.tree);
  }, [point, data]);

  const cellClean = cell && cell.inside && data.status === "ready" ? isClean(data.data.tree, cell.index) : null;
  const commodity = COMMODITIES.find((c) => c.key === commodityKey)!;
  const exporterValid = isAddress(exporter);

  // Any change to the bound inputs invalidates a generated proof.
  useEffect(() => {
    setProof(null);
    setProveError(null);
    setSubmit({ status: "idle" });
  }, [point, exporter, season]);

  async function onGenerate() {
    if (data.status !== "ready" || !cell || !cell.inside || !exporterValid) return;
    setProving(true);
    setProveError(null);
    try {
      const { tree, checkpoint } = data.data;
      const path = getPath(tree, checkpoint, cell.index);
      const r = await generateProof({
        latS: cell.latS,
        lonS: cell.lonS,
        row: cell.row,
        col: cell.col,
        path,
        root: tree.root,
        season,
        exporter: exporter as Address,
        lat0S: tree.lat0S,
        lon0S: tree.lon0S,
        stepS: tree.stepS,
      });
      setProof(r);
    } catch (e) {
      setProveError(e instanceof Error ? e.message : String(e));
    } finally {
      setProving(false);
    }
  }

  async function onSubmit() {
    if (!proof || data.status !== "ready" || !address || !publicClient) return;
    const { calldata } = proof;
    const args = [calldata.a, calldata.b, calldata.c, calldata.pubSignals, BigInt(data.data.record.gridId), commodityHash(commodity)] as const;
    setSubmit({ status: "simulating" });
    try {
      // Simulate first: a revert (e.g. NullifierAlreadyUsed) is reported by name without spending gas.
      await publicClient.simulateContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "attest",
        args,
        account: address,
        gas: ATTEST_GAS_LIMIT,
      });
      const hash = await writeContractAsync({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "attest",
        args,
        gas: ATTEST_GAS_LIMIT,
      });
      setSubmit({ status: "pending", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setSubmit({ status: "error", hash, error: { name: "Reverted", message: "The transaction reverted on-chain." } });
        return;
      }
      let id: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics });
          if (ev.eventName === "Attested") id = ev.args.id;
        } catch {
          /* not ours */
        }
      }
      setSubmit({ status: "success", hash, id });
    } catch (e) {
      setSubmit({ status: "error", error: decodeContractError(e) });
    }
  }

  const proofFile = useMemo(() => {
    if (!proof || data.status !== "ready") return null;
    const contents = proofFileContents(proof, {
      chainId: data.data.record.chainId,
      registry: data.data.record.registry,
      gridId: data.data.record.gridId,
      season,
      exporter,
      commodity: { hsCode: commodity.hsCode, description: commodity.description, hash: commodityHash(commodity) },
    });
    return { contents, url: URL.createObjectURL(new Blob([contents], { type: "application/json" })) };
  }, [proof, data, season, exporter, commodity]);
  useEffect(() => () => { if (proofFile) URL.revokeObjectURL(proofFile.url); }, [proofFile]);

  const canGenerate = data.status === "ready" && !!cell?.inside && cellClean === true && exporterValid && !proving;
  const walletReady = !!address && chainId === 84532;
  const submitBusy = submit.status === "simulating" || submit.status === "pending";

  return (
    <div className="page">
      <section className="card">
        <h1>Prove your plot is deforestation-free</h1>
        <p className="muted">
          Tap your plot on the map. Your browser looks up the cell, builds a zero-knowledge proof that the cell is
          clean in the published satellite grid, and only the proof (never the coordinates) is sent on-chain.
        </p>
        <DataStatus state={data} />
      </section>

      {data.status === "ready" && (
        <>
          <section className="card map-card">
            <AoiMap tree={data.data.tree} point={point} showLoss={showLoss} onPick={(lat, lon) => setPoint({ lat, lon })} />
            <label className="check">
              <input type="checkbox" checked={showLoss} onChange={(e) => setShowLoss(e.target.checked)} />
              Show cells flagged as loss (demo overlay)
            </label>
          </section>

          <section className="card">
            <h2>1 · Selected plot</h2>
            {!point && <p className="muted">No point selected yet — click inside the green rectangle.</p>}
            {point && cell && (
              <div className="grid2">
                <div>
                  <div className="label">Coordinates (stay on this device)</div>
                  <div className="mono">
                    {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
                  </div>
                </div>
                <div>
                  <div className="label">Cell</div>
                  <div className="mono">{cell.inside ? `row ${cell.row}, col ${cell.col}` : "outside the grid"}</div>
                </div>
                <div>
                  <div className="label">Status</div>
                  {!cell.inside && <span className="pill">outside</span>}
                  {cell.inside && cellClean && <span className="pill ok">clean</span>}
                  {cell.inside && !cellClean && <span className="pill bad">loss</span>}
                </div>
              </div>
            )}
            {cell?.inside && cellClean === false && <p className="alert bad">{LOSS_MESSAGE}</p>}
          </section>

          <section className="card">
            <h2>2 · Attestation details</h2>
            <div className="form">
              <label>
                Exporter address (the wallet that will submit the attestation)
                <input
                  className="mono"
                  value={exporter}
                  onChange={(e) => setExporter(e.target.value.trim())}
                  placeholder="0x…"
                  spellCheck={false}
                />
                {!exporterValid && exporter && <span className="hint bad">Not a valid address</span>}
              </label>
              <div className="row">
                <label>
                  Season
                  <input type="number" value={season} min={2021} max={2100} onChange={(e) => setSeason(Number(e.target.value))} />
                </label>
                <label>
                  Commodity
                  <select value={commodityKey} onChange={(e) => setCommodityKey(e.target.value)}>
                    {COMMODITIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.description} (HS {c.hsCode})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>3 · Generate proof</h2>
            <button className="btn primary" disabled={!canGenerate} onClick={onGenerate}>
              {proving ? "Proving in your browser…" : "Generate proof"}
            </button>
            {cell?.inside && cellClean === false && <p className="hint bad">Disabled: {LOSS_MESSAGE}</p>}
            {proveError && <p className="alert bad">Proof failed: {proveError}</p>}
            {proof && proofFile && (
              <div className="proof">
                <p className="alert ok">
                  Proof generated in <strong>{proof.ms} ms</strong>. Nullifier <span className="mono">{shortHex(proof.nullifier, 8)}</span>
                </p>
                <div className="row">
                  <a className="btn" href={proofFile.url} download={`zkanopy-proof-${proof.nullifier.slice(2, 10)}.json`}>
                    Download proof.json
                  </a>
                  <button className="btn" onClick={() => navigator.clipboard.writeText(proofFile.contents)}>
                    Copy proof JSON
                  </button>
                </div>
                <details>
                  <summary>Public signals (what the chain will see)</summary>
                  <pre className="mono small">
                    {["nullifier", "root", "season", "exporter", "lat0S", "lon0S", "stepS"]
                      .map((k, i) => `${k.padEnd(9)} ${proof.publicSignals[i]}`)
                      .join("\n")}
                  </pre>
                </details>
              </div>
            )}
          </section>

          <section className="card">
            <h2>4 · Submit attestation</h2>
            {!address && <p className="muted">Connect a wallet (top right) to submit. For the demo the same wallet can act as the exporter.</p>}
            {address && chainId !== 84532 && <p className="alert warn">Switch the wallet to Base Sepolia.</p>}
            {address && exporterValid && address.toLowerCase() !== exporter.toLowerCase() && (
              <p className="alert warn">
                The proof is bound to {shortHex(exporter)} but the connected wallet is {shortHex(address)} — the contract will
                reject it with <span className="mono">ExporterMismatch</span>. Download the proof and let the exporter submit it, or use the same address.
              </p>
            )}
            <button className="btn primary" disabled={!proof || !walletReady || submitBusy} onClick={onSubmit}>
              {submit.status === "simulating" ? "Checking with the contract…" : submit.status === "pending" ? "Waiting for confirmation…" : "Submit attestation"}
            </button>
            {submit.status === "pending" && (
              <p className="alert">
                Transaction sent: <a href={txUrl(submit.hash)} target="_blank" rel="noreferrer" className="mono">{shortHex(submit.hash, 8)}</a>
              </p>
            )}
            {submit.status === "success" && (
              <p className="alert ok">
                Attestation {submit.id !== null ? `#${submit.id.toString()}` : ""} recorded ·{" "}
                <a href={txUrl(submit.hash)} target="_blank" rel="noreferrer" className="mono">{shortHex(submit.hash, 8)}</a>
              </p>
            )}
            {submit.status === "error" && (
              <p className="alert bad">
                <strong className="mono">{submit.error.name}</strong> — {submit.error.message}
                {submit.hash && (
                  <>
                    {" "}
                    <a href={txUrl(submit.hash)} target="_blank" rel="noreferrer" className="mono">{shortHex(submit.hash, 8)}</a>
                  </>
                )}
              </p>
            )}
          </section>
        </>
      )}

      <section className="card privacy">
        <strong>Privacy:</strong> your coordinates are never sent to a server or to the chain. This page downloads the
        public grid once and does every lookup and the proof locally; the transaction carries only the nullifier, the grid
        root and parameters, the season and the exporter address.
      </section>
    </div>
  );
}

function DataStatus({ state }: { state: DataState }) {
  if (state.status === "loading") return <p className="hint">Loading the published grid (tree.json, ~3 MB)…</p>;
  if (state.status === "error") return <p className="alert bad">Could not load grid data: {state.message}</p>;
  const { data, verified, onchainRoot } = state;
  return (
    <p className="hint">
      Grid <strong>{data.tree.name}</strong> v{data.tree.version} · {data.tree.rows}×{data.tree.cols} cells · grid id {data.record.gridId} ·{" "}
      root <span className="mono">{shortHex(data.record.rootHex)}</span>{" "}
      {verified ? (
        <span className="pill ok">matches on-chain root</span>
      ) : onchainRoot === null ? (
        <span className="pill">on-chain check unavailable</span>
      ) : (
        <span className="pill bad">differs from on-chain root</span>
      )}
    </p>
  );
}
