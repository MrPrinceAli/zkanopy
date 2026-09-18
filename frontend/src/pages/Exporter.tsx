// /exporter — list the attestations addressed to an exporter and export them as DDS JSON (PRD 5.6, 5.7).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, usePublicClient } from "wagmi";
import { isAddress, type Address } from "viem";
import { addressUrl, shortHex, txUrl } from "../lib/contract";
import { commodityFromHash, fetchAttestationsOf, fetchGridsFor, formatTime, toHex32, type AttestationRecord, type GridRecordOnchain } from "../lib/registry";
import { buildDds, ddsFileName } from "../lib/dds";
import { CHAIN_ID, REGISTRY_ADDRESS } from "../config";
import { useI18n, type Key } from "../i18n";
import { Package } from "lucide-react";

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
  const { t } = useI18n();
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
    <div className="app-page wide">
      <header className="page-head">
        <p className="eyebrow">{t("exporter.eyebrow")}</p>
        <h1>
          {t("exporter.h")} <em>{t("exporter.hEm")}</em>
        </h1>
        <p className="lede">{t("exporter.lede")}</p>
      </header>

      {!wallet && (
        <section className="panel">
          <div className="form">
            <label>
              {t("exporter.addr")}
              <input className="mono" value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
            </label>
          </div>
        </section>
      )}
      {address && (
        <p className="hint">
          {t("exporter.label")}{" "}
          <a href={addressUrl(address)} target="_blank" rel="noreferrer" className="mono">
            {address}
          </a>
        </p>
      )}

      {state.status === "loading" && <p className="panel hint">{t("exporter.loading")}</p>}
      {state.status === "error" && <p className="panel alert bad">{t("exporter.error", { msg: state.message })}</p>}

      {state.status === "ready" && (
        <section className="panel">
          <div className="panel-head">
            <span className="panel-num">{String(state.atts.length).padStart(2, "0")}</span>
            <span className="panel-title"><Package size={16} />{state.atts.length === 1 ? t("exporter.one") : t("exporter.many")}</span>
          </div>
          {state.atts.length === 0 && <p className="muted">{t("exporter.none")}</p>}
          {state.atts.length > 0 && (
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label={t("exporter.selectAll")}
                        checked={selected.size === state.atts.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(state.atts.map((a) => a.id)) : new Set())}
                      />
                    </th>
                    <th>{t("exporter.col.id")}</th>
                    <th>{t("exporter.col.season")}</th>
                    <th>{t("exporter.col.commodity")}</th>
                    <th>{t("exporter.col.nullifier")}</th>
                    <th>{t("exporter.col.time")}</th>
                    <th>{t("exporter.col.tx")}</th>
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
                          {t(`commodity.${c.key}` as Key)} <span className="muted">(HS {c.hsCode})</span>
                        </td>
                        <td className="mono" title={toHex32(a.nullifier)}>
                          {shortHex(toHex32(a.nullifier))}
                        </td>
                        <td className="mono small">{formatTime(a.timestamp)}</td>
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
            <div className="form" style={{ marginTop: 20 }}>
              <label>
                {t("exporter.eori")}
                <input value={eori} onChange={(e) => setEori(e.target.value.trim())} placeholder="PLACEHOLDER" />
              </label>
              <div className="row">
                <button className="btn primary" disabled={docs.length === 0} onClick={exportDds}>
                  {t("exporter.export", { n: selected.size, files: docs.length > 1 ? t("exporter.files", { n: docs.length }) : "" })}
                </button>
              </div>
              {docs.length > 1 && <p className="hint">{t("exporter.multi")}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
