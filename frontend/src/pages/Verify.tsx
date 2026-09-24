// /verify/:id — public view of one attestation and the grid it was proven against (PRD 5.6). No wallet needed.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePublicClient } from "wagmi";
import type { Hex } from "viem";
import { addressUrl, decodeContractError, shortHex, txUrl } from "../lib/contract";
import { commodityFromHash, fetchAttestation, fetchGrid, fetchTxHash, formatTime, toHex32, type AttestationRecord, type GridRecordOnchain } from "../lib/registry";
import { CHAIN_NAME, EXPLORER_URL, REGISTRY_ADDRESS } from "../config";
import { useI18n, type Key } from "../i18n";
import { loadRegions } from "../lib/regions";
import { Layers, ShieldCheck } from "lucide-react";

type State =
  | { status: "loading" }
  | { status: "ready"; att: AttestationRecord; grid: GridRecordOnchain; txHash?: Hex }
  | { status: "error"; message: string };

export default function Verify() {
  const { t } = useI18n();
  const { id } = useParams();
  const publicClient = usePublicClient();
  const [state, setState] = useState<State>({ status: "loading" });
  // gridId -> region slug, so the metadata link points at the grid this attestation actually used.
  const [slugByGrid, setSlugByGrid] = useState<Record<string, string>>({});

  useEffect(() => {
    loadRegions()
      .then((f) => setSlugByGrid(Object.fromEntries(f.regions.map((r) => [String(r.gridId), r.slug]))))
      .catch(() => setSlugByGrid({}));
  }, []);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        if (!id || !/^\d+$/.test(id)) throw new Error("attestation id must be a number");
        const att = await fetchAttestation(publicClient, BigInt(id));
        const [grid, txHash] = await Promise.all([fetchGrid(publicClient, att.gridId), fetchTxHash(publicClient, att.id, att.timestamp)]);
        if (!cancelled) setState({ status: "ready", att, grid, txHash });
      } catch (e) {
        const d = decodeContractError(e);
        if (!cancelled) setState({ status: "error", message: d.name === "UnknownAttestation" ? t("verify.notFound", { id: id ?? "" }) : d.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, publicClient, t]);

  if (state.status === "loading")
    return (
      <div className="app-page">
        <p className="hint">{t("verify.reading", { id: id ?? "", chain: CHAIN_NAME })}</p>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="app-page">
        <p className="alert bad">{state.message}</p>
      </div>
    );

  const { att, grid, txHash } = state;
  const c = commodityFromHash(att.commodityHash);
  const metaIsHash = grid.metadataURI.startsWith("sha256:");

  return (
    <div className="app-page">
      <header className="page-head">
        <p className="eyebrow">{t("verify.eyebrow")}</p>
        <h1>{t("verify.h", { id: att.id.toString() })}</h1>
        <p className="alert ok">{t("verify.banner")}</p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-num">01</span>
          <span className="panel-title"><ShieldCheck size={16} />{t("verify.s1")}</span>
        </div>
        <dl className="kv">
          <dt>{t("verify.exporter")}</dt>
          <dd>
            <a href={addressUrl(att.exporter)} target="_blank" rel="noreferrer" className="mono">{att.exporter}</a>
          </dd>
          <dt>{t("verify.season")}</dt>
          <dd>{att.season}</dd>
          <dt>{t("verify.commodity")}</dt>
          <dd>
            {t(`commodity.${c.key}` as Key)} (HS {c.hsCode}) <span className="muted mono">{shortHex(att.commodityHash)}</span>
          </dd>
          <dt>{t("verify.nullifier")}</dt>
          <dd className="mono">{toHex32(att.nullifier)}</dd>
          <dt>{t("verify.recorded")}</dt>
          <dd>{formatTime(att.timestamp)}</dd>
          <dt>{t("verify.tx")}</dt>
          <dd>
            {txHash ? (
              <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="mono">{txHash}</a>
            ) : (
              <span className="muted">{t("verify.txNA")}</span>
            )}
          </dd>
          <dt>{t("verify.registry")}</dt>
          <dd>
            <a href={addressUrl(REGISTRY_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{REGISTRY_ADDRESS}</a> {t("verify.on")} {CHAIN_NAME}
          </dd>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-num">02</span>
          <span className="panel-title"><Layers size={16} />{t("verify.s2", { id: grid.gridId.toString(), v: grid.version })}</span>
        </div>
        <dl className="kv">
          <dt>{t("verify.root")}</dt>
          <dd className="mono">{toHex32(grid.root)}</dd>
          <dt>{t("verify.cells")}</dt>
          <dd>
            {t("verify.cellsV", { rows: grid.rows, cols: grid.cols, step: grid.stepS.toString(), lat: grid.lat0S.toString(), lon: grid.lon0S.toString() })}
          </dd>
          <dt>{t("verify.published")}</dt>
          <dd>{formatTime(grid.publishedAt)}</dd>
          <dt>{t("verify.metadata")}</dt>
          <dd>
            <span className="mono">{grid.metadataURI}</span>
            {metaIsHash && slugByGrid[grid.gridId.toString()] && (
              <>
                {" "}
                —{" "}
                <a href={`/data/${slugByGrid[grid.gridId.toString()]}/metadata.json`} target="_blank" rel="noreferrer">
                  metadata.json
                </a>{" "}
                {t("verify.metaNote")}
              </>
            )}
          </dd>
        </dl>
        <p className="hint">
          {t("verify.explorer")} <a href={`${EXPLORER_URL}/address/${REGISTRY_ADDRESS}#events`} target="_blank" rel="noreferrer">{t("verify.events")}</a> ·{" "}
          <Link to="/regulator">{t("verify.monitor")}</Link>
        </p>
      </section>
    </div>
  );
}
