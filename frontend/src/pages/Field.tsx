// /field — field verification. An auditor standing on a plot checks that it is the plot an attestation was
// made for, by recomputing Poseidon(row, col, season) and matching it against the stored nullifier.
// Everything happens locally: the plot's location is typed into this page and never sent anywhere.
import { useState } from "react";
import { Link } from "react-router-dom";
import { usePublicClient } from "wagmi";
import { MapPin, ScanSearch } from "lucide-react";
import { cellOf, nullifierOf, type CellGrid } from "../lib/merkle";
import { commodityFromHash, fetchAttestation, fetchGrid, formatTime, toHex32, type AttestationRecord, type GridRecordOnchain } from "../lib/registry";
import { addressUrl, decodeContractError, shortHex } from "../lib/contract";
import { CHAIN_NAME } from "../config";
import { useI18n, type Key } from "../i18n";

type Mode = "coords" | "cell";

interface Checked {
  att: AttestationRecord;
  grid: GridRecordOnchain;
  row: number;
  col: number;
  inside: boolean;
  expected: bigint;
  match: boolean;
}

type State = { status: "idle" } | { status: "busy" } | { status: "done"; r: Checked } | { status: "error"; message: string };

/** The on-chain Grid carries bigints; cellOf works in numbers (all values are far below 2^53). */
const toCellGrid = (g: GridRecordOnchain): CellGrid => ({
  lat0S: Number(g.lat0S),
  lon0S: Number(g.lon0S),
  stepS: Number(g.stepS),
  cols: g.cols,
  rows: g.rows,
});

export default function Field() {
  const { t } = useI18n();
  const publicClient = usePublicClient();
  const [id, setId] = useState("1");
  const [mode, setMode] = useState<Mode>("coords");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [row, setRow] = useState("");
  const [col, setCol] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  const idValid = /^\d+$/.test(id.trim()) && BigInt(id.trim()) > 0n;
  const coordsValid = Number.isFinite(Number(lat)) && lat.trim() !== "" && Number.isFinite(Number(lon)) && lon.trim() !== "";
  const cellValid = /^\d+$/.test(row.trim()) && /^\d+$/.test(col.trim());
  const canCheck = idValid && (mode === "coords" ? coordsValid : cellValid) && !!publicClient && state.status !== "busy";

  async function onCheck() {
    if (!publicClient) return;
    setState({ status: "busy" });
    try {
      const att = await fetchAttestation(publicClient, BigInt(id.trim()));
      const grid = await fetchGrid(publicClient, att.gridId);

      // The cell comes from the grid parameters the contract itself stores, so this check does not
      // depend on any file this site serves.
      let r: number;
      let c: number;
      let inside: boolean;
      if (mode === "coords") {
        const hit = cellOf(Number(lat), Number(lon), toCellGrid(grid));
        r = hit.row;
        c = hit.col;
        inside = hit.inside;
      } else {
        r = Number(row);
        c = Number(col);
        inside = r >= 0 && r < grid.rows && c >= 0 && c < grid.cols;
      }

      const expected = inside ? nullifierOf(r, c, att.season) : 0n;
      setState({ status: "done", r: { att, grid, row: r, col: c, inside, expected, match: inside && expected === att.nullifier } });
    } catch (e) {
      const d = decodeContractError(e);
      setState({ status: "error", message: d.name === "UnknownAttestation" ? t("field.notFound", { id: id.trim() }) : d.message });
    }
  }

  return (
    <div className="app-page">
      <header className="page-head">
        <p className="eyebrow">{t("field.eyebrow")}</p>
        <h1>{t("field.h")}</h1>
        <p className="hint">{t("field.lede")}</p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-num">01</span>
          <span className="panel-title"><MapPin size={16} />{t("field.s1")}</span>
        </div>
        <div className="form">
          <label>
            {t("field.id")}
            <input className="mono" value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="1" spellCheck={false} />
            {!idValid && id !== "" && <span className="hint bad">{t("field.idBad")}</span>}
          </label>

          <div className="row">
            <label className="check">
              <input type="radio" name="mode" checked={mode === "coords"} onChange={() => setMode("coords")} />
              {t("field.modeCoords")}
            </label>
            <label className="check">
              <input type="radio" name="mode" checked={mode === "cell"} onChange={() => setMode("cell")} />
              {t("field.modeCell")}
            </label>
          </div>

          {mode === "coords" ? (
            <div className="row">
              <label>
                {t("field.lat")}
                <input className="mono" value={lat} onChange={(e) => setLat(e.target.value.trim())} placeholder="4.6400" spellCheck={false} />
              </label>
              <label>
                {t("field.lon")}
                <input className="mono" value={lon} onChange={(e) => setLon(e.target.value.trim())} placeholder="96.8400" spellCheck={false} />
              </label>
            </div>
          ) : (
            <div className="row">
              <label>
                {t("field.row")}
                <input className="mono" value={row} onChange={(e) => setRow(e.target.value.trim())} placeholder="100" spellCheck={false} />
              </label>
              <label>
                {t("field.col")}
                <input className="mono" value={col} onChange={(e) => setCol(e.target.value.trim())} placeholder="100" spellCheck={false} />
              </label>
            </div>
          )}
        </div>

        <button className="btn primary" disabled={!canCheck} onClick={onCheck} style={{ marginTop: 12 }}>
          {state.status === "busy" ? t("field.checking") : t("field.check")}
        </button>
        <p className="hint" style={{ marginTop: 10 }}>{t("field.privacy")}</p>
      </section>

      {state.status === "error" && <p className="alert bad">{state.message}</p>}

      {state.status === "done" && (
        <section className="panel">
          <div className="panel-head">
            <span className="panel-num">02</span>
            <span className="panel-title"><ScanSearch size={16} />{t("field.s2", { id: state.r.att.id.toString() })}</span>
          </div>

          {!state.r.inside ? (
            <p className="alert bad">{t("field.outside", { id: state.r.grid.gridId.toString(), rows: state.r.grid.rows, cols: state.r.grid.cols })}</p>
          ) : state.r.match ? (
            <p className="alert ok">{t("field.match", { row: state.r.row, col: state.r.col, season: state.r.att.season })}</p>
          ) : (
            <p className="alert bad">{t("field.noMatch", { row: state.r.row, col: state.r.col, season: state.r.att.season })}</p>
          )}

          <dl className="kv">
            <dt>{t("field.cell")}</dt>
            <dd className="mono">{state.r.inside ? `row ${state.r.row} · col ${state.r.col}` : t("field.cellOutside")}</dd>
            <dt>{t("field.expected")}</dt>
            <dd className="mono">{state.r.inside ? toHex32(state.r.expected) : "—"}</dd>
            <dt>{t("field.stored")}</dt>
            <dd className="mono">{toHex32(state.r.att.nullifier)}</dd>
            <dt>{t("field.season")}</dt>
            <dd>{state.r.att.season}</dd>
            <dt>{t("field.commodity")}</dt>
            <dd>
              {t(`commodity.${commodityFromHash(state.r.att.commodityHash).key}` as Key)}{" "}
              <span className="muted mono">{shortHex(state.r.att.commodityHash)}</span>
            </dd>
            <dt>{t("field.exporter")}</dt>
            <dd>
              <a href={addressUrl(state.r.att.exporter)} target="_blank" rel="noreferrer" className="mono">{state.r.att.exporter}</a>
            </dd>
            <dt>{t("field.recorded")}</dt>
            <dd>{formatTime(state.r.att.timestamp)}</dd>
            <dt>{t("field.grid")}</dt>
            <dd>{t("field.gridV", { id: state.r.grid.gridId.toString(), v: state.r.grid.version, chain: CHAIN_NAME })}</dd>
          </dl>

          <p className="hint">
            {t("field.note")} <Link to={`/verify/${state.r.att.id}`}>{t("field.openVerify", { id: state.r.att.id.toString() })}</Link>
          </p>
        </section>
      )}
    </div>
  );
}
