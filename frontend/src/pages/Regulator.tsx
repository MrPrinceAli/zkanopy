// /regulator — per-exporter claim-pattern risk scores computed off-chain from on-chain Attested events
// by oracle/06_claim_anomaly.py (AI component #2). No wallet needed.
import { useEffect, useState } from "react";
import { addressUrl, shortHex } from "../lib/contract";
import { loadRisk, riskClass, type RiskFile } from "../lib/risk";
import { useI18n } from "../i18n";
import { Radar } from "lucide-react";

type State = { status: "loading" } | { status: "ready"; risk: RiskFile } | { status: "error"; message: string };

export default function Regulator() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    loadRisk()
      .then((risk) => setState({ status: "ready", risk }))
      .catch((e) => setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);

  return (
    <div className="app-page wide">
      <header className="page-head">
        <p className="eyebrow"><Radar size={14} /> {t("regulator.eyebrow")}</p>
        <h1>
          {t("regulator.h")} <em>{t("regulator.hEm")}</em>
        </h1>
        <p className="lede">{t("regulator.lede")}</p>
        {state.status === "loading" && <p className="hint">{t("regulator.loading")}</p>}
        {state.status === "error" && <p className="alert bad">{t("regulator.error", { msg: state.message })}</p>}
        {state.status === "ready" && (
          <p className="hint">
            {t("regulator.summary", {
              claims: state.risk.n_claims,
              exporters: state.risk.exporters.length,
              from: state.risk.fromBlock,
              to: state.risk.toBlock,
              at: state.risk.generatedAt.replace("T", " ").slice(0, 19),
              model: state.risk.model.type,
            })}{" "}
            <span className="mono">{state.risk.model.features.join(", ")}</span>
            {state.risk.status !== "ok" && <span className="pill warn"> {state.risk.status}</span>}
          </p>
        )}
      </header>

      {state.status === "ready" && (
        <section className="panel">
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("regulator.col.risk")}</th>
                  <th>{t("regulator.col.exporter")}</th>
                  <th>{t("regulator.col.claims")}</th>
                  <th>{t("regulator.col.hour")}</th>
                  <th>{t("regulator.col.near")}</th>
                  <th>{t("regulator.col.seasons")}</th>
                  <th>{t("regulator.col.why")}</th>
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
                    <td className="mono">{e.n_claims}</td>
                    <td className="mono">{e.max_claims_per_hour}</td>
                    <td className="mono">{Math.round(e.near_ratio * 100)}%</td>
                    <td className="mono">{e.seasons.join(", ")}</td>
                    <td>
                      {e.reasons.length === 0 ? (
                        <span className="muted">{t("regulator.nothing")}</span>
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
          <p className="hint">{t("regulator.note")}</p>
        </section>
      )}
    </div>
  );
}
