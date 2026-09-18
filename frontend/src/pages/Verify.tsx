// /verify/:id — public view of one attestation and the grid it was proven against (PRD 5.6). No wallet needed.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { addressUrl, decodeContractError, shortHex, txUrl } from "../lib/contract";
import { commodityFromHash, fetchAttestation, fetchGrid, fetchTxHash, formatTime, toHex32, type AttestationRecord, type GridRecordOnchain } from "../lib/registry";
import { CHAIN_NAME, EXPLORER_URL, REGISTRY_ADDRESS } from "../config";

type State =
  | { status: "loading" }
  | { status: "ready"; att: AttestationRecord; grid: GridRecordOnchain; txHash?: Hex }
  | { status: "error"; message: string };

export default function Verify() {
  const { id } = useParams();
  const publicClient = usePublicClient();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        if (!id || !/^\d+$/.test(id)) throw new Error("attestation id must be a number");
        const att = await fetchAttestation(publicClient, BigInt(id));
        const [grid, txHash] = await Promise.all([fetchGrid(publicClient, att.gridId), fetchTxHash(publicClient, att.id)]);
        if (!cancelled) setState({ status: "ready", att, grid, txHash });
      } catch (e) {
        const d = decodeContractError(e);
        if (!cancelled) setState({ status: "error", message: d.name === "UnknownAttestation" ? `Attestation #${id} does not exist.` : d.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, publicClient]);

  if (state.status === "loading") return <p className="page card hint">Reading attestation #{id} from {CHAIN_NAME}…</p>;
  if (state.status === "error") return <p className="page card alert bad">{state.message}</p>;

  const { att, grid, txHash } = state;
  const c = commodityFromHash(att.commodityHash);
  const metaIsHash = grid.metadataURI.startsWith("sha256:");

  return (
    <div className="page">
      <section className="card">
        <h1>Attestation #{att.id.toString()}</h1>
        <p className="alert ok">
          Verified on-chain: a zero-knowledge proof that an undisclosed plot lies in a cell with no detected deforestation after
          2020-12-31 was accepted by the Registry. The plot's coordinates are not on-chain and cannot be recovered from this record.
        </p>
        <dl className="kv">
          <dt>Exporter</dt>
          <dd>
            <a href={addressUrl(att.exporter)} target="_blank" rel="noreferrer" className="mono">{att.exporter}</a>
          </dd>
          <dt>Season</dt>
          <dd>{att.season}</dd>
          <dt>Commodity</dt>
          <dd>
            {c.description} (HS {c.hsCode}) <span className="muted mono">{shortHex(att.commodityHash)}</span>
          </dd>
          <dt>Nullifier</dt>
          <dd className="mono">{toHex32(att.nullifier)}</dd>
          <dt>Recorded</dt>
          <dd>{formatTime(att.timestamp)}</dd>
          <dt>Transaction</dt>
          <dd>
            {txHash ? (
              <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="mono">{txHash}</a>
            ) : (
              <span className="muted">not available from this RPC</span>
            )}
          </dd>
          <dt>Registry</dt>
          <dd>
            <a href={addressUrl(REGISTRY_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{REGISTRY_ADDRESS}</a> on {CHAIN_NAME}
          </dd>
        </dl>
      </section>

      <section className="card">
        <h2>Grid #{grid.gridId.toString()} · version {grid.version}</h2>
        <dl className="kv">
          <dt>Merkle root</dt>
          <dd className="mono">{toHex32(grid.root)}</dd>
          <dt>Cells</dt>
          <dd>
            {grid.rows} × {grid.cols}, cell size {grid.stepS.toString()} (fixed-point 1e-6°), origin latS {grid.lat0S.toString()} / lonS{" "}
            {grid.lon0S.toString()}
          </dd>
          <dt>Published</dt>
          <dd>{formatTime(grid.publishedAt)}</dd>
          <dt>Metadata</dt>
          <dd>
            <span className="mono">{grid.metadataURI}</span>
            {metaIsHash && (
              <>
                {" "}
                — <a href="/data/metadata.json" target="_blank" rel="noreferrer">metadata.json</a> (its sha256 must equal this value)
              </>
            )}
          </dd>
        </dl>
        <p className="hint">
          Explorer: <a href={`${EXPLORER_URL}/address/${REGISTRY_ADDRESS}#events`} target="_blank" rel="noreferrer">Registry events</a> ·{" "}
          <Link to="/regulator">claim anomaly monitor</Link>
        </p>
      </section>
    </div>
  );
}
