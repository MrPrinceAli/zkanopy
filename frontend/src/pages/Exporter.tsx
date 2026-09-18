// /exporter — list the attestations addressed to an exporter and export them as DDS JSON (PRD 5.6, 5.7).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress, type Address } from "viem";
import { addressUrl, shortHex, txUrl } from "../lib/contract";
import { commodityFromHash, fetchAttestationsOf, fetchGridsFor, formatTime, toHex32, type AttestationRecord, type GridRecordOnchain } from "../lib/registry";
import { buildDds, ddsFileName } from "../lib/dds";
import { CHAIN_ID, REGISTRY_ADDRESS } from "../config";

type State =
  | { status: "idle" }
  | { status: "loading"; address: Address }
  | { status: "ready"; address: Address; atts: AttestationRecord[]; grids: Map<bigint, GridRecordOnchain> }
  | { status: "error"; address: Address; message: string };

function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Exporter() {
  const { address: wallet } = useAccount();
  const publicClient = usePublicClient();
  const [manual, setManual] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [selected, setSelected] = useState<Set<bigint>>(new Set());
  const [eori, setEori] = useState("");

  const address: Address | null = wallet ?? (isAddress(manual) ? manual : null);

  useEffect(() => {
    if (!address || !publicClient) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", address });
    setSelected(new Set());
    (async () => {
      try {
        const atts = await fetchAttestationsOf(publicClient, address);
        const grids = await fetchGridsFor(publicClient, atts);
        if (!cancelled) setState({ status: "ready", address, atts, grids });
      } catch (e) {
        if (!cancelled) setState({ status: "error", address, message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  const docs = useMemo(() => {
    if (state.status !== "ready" || selected.size === 0) return [];
    const chosen = state.atts.filter((a) => selected.has(a.id));
    return buildDds(state.address, chosen, state.grids, { chainId: CHAIN_ID, contract: REGISTRY_ADDRESS, eori: eori || undefined });
  }, [state, selected, eori]);

  function toggle(id: bigint) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function exportDds() {
    docs.forEach((d, i) => setTimeout(() => download(ddsFileName(d), JSON.stringify(d, null, 2)), i * 300));
  }

  return (
    <div className="page">
      <section className="card">
        <h1>Exporter · attestations addressed to you</h1>
        <p className="muted">
          Attestations are bound to the exporter address that submitted them. Select the ones for a shipment and export a
          Due Diligence Statement (DDS) JSON — a conceptual mapping to the TRACES DDS fields, not the official format.
        </p>
        {!wallet && (
          <label className="form">
            Connect a wallet (top right), or view the public attestation list of any exporter address
            <input className="mono" value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
          </label>
        )}
        {address && (
          <p className="hint">
            Exporter <a href={addressUrl(address)} target="_blank" rel="noreferrer" className="mono">{address}</a>
          </p>
        )}
      </section>

      {state.status === "loading" && <p className="card hint">Loading attestations from Base Sepolia…</p>}
      {state.status === "error" && <p className="card alert bad">Could not load attestations: {state.message}</p>}

      {state.status === "ready" && (
        <section className="card">
          <h2>{state.atts.length} attestation{state.atts.length === 1 ? "" : "s"}</h2>
          {state.atts.length === 0 && <p className="muted">No attestations yet for this address.</p>}
          {state.atts.length > 0 && (
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="select all"
                        checked={selected.size === state.atts.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(state.atts.map((a) => a.id)) : new Set())}
                      />
                    </th>
                    <th>id</th>
                    <th>season</th>
                    <th>commodity</th>
                    <th>nullifier</th>
                    <th>time</th>
                    <th>tx</th>
                  </tr>
                </thead>
                <tbody>
                  {state.atts.map((a) => {
                    const c = commodityFromHash(a.commodityHash);
                    return (
                      <tr key={a.id.toString()}>
                        <td>
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`select ${a.id}`} />
                        </td>
                        <td>
                          <Link to={`/verify/${a.id}`}>#{a.id.toString()}</Link>
                        </td>
                        <td>{a.season}</td>
                        <td>
                          {c.description} <span className="muted">(HS {c.hsCode})</span>
                        </td>
                        <td className="mono" title={toHex32(a.nullifier)}>
                          {shortHex(toHex32(a.nullifier))}
                        </td>
                        <td>{formatTime(a.timestamp)}</td>
                        <td>
                          {a.txHash ? (
                            <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" className="mono">
                              {shortHex(a.txHash, 4)}
                            </a>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {state.atts.length > 0 && (
            <div className="form" style={{ marginTop: 12 }}>
              <label>
                Operator EORI (optional, written into the DDS)
                <input value={eori} onChange={(e) => setEori(e.target.value.trim())} placeholder="PLACEHOLDER" />
              </label>
              <div className="row">
                <button className="btn primary" disabled={docs.length === 0} onClick={exportDds}>
                  Export DDS JSON ({selected.size} selected{docs.length > 1 ? `, ${docs.length} files` : ""})
                </button>
              </div>
              {docs.length > 1 && (
                <p className="hint">The selection spans several commodities or seasons; one DDS file is produced per combination.</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
