// /regulator — per-exporter claim-pattern risk scores computed off-chain from on-chain Attested events
// by oracle/06_claim_anomaly.py (AI component #2). No wallet needed.
import { useEffect, useState } from "react";
import { addressUrl, shortHex } from "../lib/contract";

interface RiskExporter {
  address: string;
  n_claims: number;
  max_claims_per_hour: number;
  near_ratio: number;
  peers_same_season: number;
  span_hours: number;
  seasons: number[];
  first_claim: string;
  last_claim: string;
  anomaly_score: number;
  risk_score: number;
  reasons: string[];
}

interface RiskFile {
  generatedAt: string;
  chainId: number;
  registry: string;
  fromBlock: number;
  toBlock: number;
  n_claims: number;
  status: string;
  model: { type: string; features: string[]; near_seconds: number };
  exporters: RiskExporter[];
}

type State = { status: "loading" } | { status: "ready"; risk: RiskFile } | { status: "error"; message: string };

const riskClass = (r: number) => (r >= 0.7 ? "bad" : r >= 0.4 ? "warn" : "ok");

export default function Regulator() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    fetch("/data/risk.json")
      .then((r) => {
        if (!r.ok) throw new Error(`risk.json: HTTP ${r.status}`);
        return r.json() as Promise<RiskFile>;
      })
      .then((risk) => setState({ status: "ready", risk }))
      .catch((e) => setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);

  return (
    <div className="page">
      <section className="card">
        <h1>Regulator · claim anomaly monitor</h1>
        <p className="muted">
          The blockchain guarantees the AI's input (every attestation is a verified proof that nobody can edit); the AI watches
          the blockchain for suspicious claiming patterns. An IsolationForest scores each exporter on how many claims it makes,
          how bursty they are and how close together they land — a wallet that fires dozens of attestations in minutes stands out.
        </p>
        {state.status === "loading" && <p className="hint">Loading risk.json…</p>}
        {state.status === "error" && (
          <p className="alert bad">Could not load risk scores: {state.message}. Run <span className="mono">oracle/06_claim_anomaly.py</span>.</p>
        )}
        {state.status === "ready" && (
          <p className="hint">
            {state.risk.n_claims} attestations from {state.risk.exporters.length} exporters, blocks {state.risk.fromBlock}–{state.risk.toBlock},
            computed {state.risk.generatedAt.replace("T", " ").slice(0, 19)} UTC · {state.risk.model.type} on{" "}
            <span className="mono">{state.risk.model.features.join(", ")}</span>
            {state.risk.status !== "ok" && <span className="pill warn"> {state.risk.status}</span>}
          </p>
        )}
      </section>

      {state.status === "ready" && (
        <section className="card">
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>risk</th>
                  <th>exporter</th>
                  <th>claims</th>
                  <th>max / hour</th>
                  <th>near-in-time</th>
                  <th>seasons</th>
                  <th>why</th>
                </tr>
              </thead>
              <tbody>
                {state.risk.exporters.map((e) => (
                  <tr key={e.address}>
                    <td>
                      <span className={`pill ${riskClass(e.risk_score)}`}>{e.risk_score.toFixed(2)}</span>
                    </td>
                    <td>
                      <a href={addressUrl(e.address)} target="_blank" rel="noreferrer" className="mono" title={e.address}>
                        {shortHex(e.address)}
                      </a>
                    </td>
                    <td>{e.n_claims}</td>
                    <td>{e.max_claims_per_hour}</td>
                    <td>{Math.round(e.near_ratio * 100)}%</td>
                    <td>{e.seasons.join(", ")}</td>
                    <td>
                      {e.reasons.length === 0 ? (
                        <span className="muted">nothing unusual</span>
                      ) : (
                        <ul className="reasons">
                          {e.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Risk 1.00 = most anomalous exporter in this set, 0.00 = least. Scores are relative and recomputed each time the script
            runs; they flag wallets for review, they do not block anything on-chain.
          </p>
        </section>
      )}
    </div>
  );
}
