// /farmer — pick a plot on the map, prove it sits in a clean cell, submit the attestation (PRD 5.6).
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, type Address } from "viem";
import AoiMap from "../components/AoiMap";
import { loadGridData, type GridData } from "../lib/data";
import { FALLBACK_REGION, loadRegions, type RegionInfo } from "../lib/regions";
import { cellOf, checkpointRoot, getPath, isClean, type CellHit } from "../lib/merkle";
import { generateProof, proofFileContents, type ProofResult } from "../lib/prover";
import {
  ATTEST_GAS_LIMIT,
  COMMODITIES,
  REGISTRY_ABI,
  commodityHash,
  decodeContractError,
  isKnownError,
  shortHex,
  txUrl,
  type DecodedError,
} from "../lib/contract";
import { REGISTRY_ADDRESS } from "../config";
import { useI18n, type Key } from "../i18n";
import { Cpu, FileSignature, Lock, MapPin, Search, Send } from "lucide-react";

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

export default function Farmer() {
  const { t } = useI18n();
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
  // Which published region the farmer is working in. The manifest may list many; a checkout without
  // regions.json still gets the first grid through FALLBACK_REGION.
  const [regions, setRegions] = useState<RegionInfo[] | null>(null);
  const [region, setRegion] = useState<string>(FALLBACK_REGION);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<[[number, number], [number, number]] | null>(null);
  // Set when the farmer drops a pin outside every published grid.
  const [uncovered, setUncovered] = useState(false);

  useEffect(() => {
    loadRegions()
      .then((f) => {
        setRegions(f.regions);
        setRegion((cur) => (f.regions.some((r) => r.slug === cur) ? cur : f.default || f.regions[0].slug));
      })
      .catch(() => setRegions(null));
  }, []);

  /** The published region whose grid contains this point, if any. */
  const regionAt = (lat: number, lon: number): RegionInfo | undefined =>
    (regions ?? []).find(
      (r) => lat >= r.bounds[0][0] && lat <= r.bounds[1][0] && lon >= r.bounds[0][1] && lon <= r.bounds[1][1],
    );

  /** Pin anywhere: the app finds the region itself, so the farmer never has to know what a grid is. */
  function pick(lat: number, lon: number) {
    const hit = regionAt(lat, lon);
    setUncovered(!hit);
    if (!hit) return;
    setPoint({ lat, lon });
    if (hit.slug !== region) setRegion(hit.slug); // loads that grid; the effect resets proof state
  }

  /** Local search over the published regions — no request leaves the device. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !regions) return [];
    return regions
      .filter((r) => [r.label, r.country, r.commodity, r.name].some((f) => f.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [query, regions]);

  const lossMessage = t("farmer.lossMsg");
  const errorText = (d: DecodedError) => (isKnownError(d.name) ? t(`errors.${d.name}` as Key) : d.message);

  // Load tree.json / checkpoint.json / grid.json once, then verify the checkpoint against the on-chain root.
  useEffect(() => {
    let cancelled = false;
    setData({ status: "loading" });
    setProof(null);
    setSubmit({ status: "idle" });
    (async () => {
      try {
        const d = await loadGridData(region);
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
  }, [publicClient, region]);

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
    <div className="app-page">
      <header className="page-head">
        <p className="eyebrow">{t("farmer.eyebrow")}</p>
        <h1>
          {t("farmer.h")} <em>{t("farmer.hEm")}</em>
        </h1>
        <p className="lede">{t("farmer.lede")}</p>
        <DataStatus state={data} />
      </header>

      <section className="panel tight">
        <div className="map-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("farmer.searchPlaceholder")}
            aria-label={t("farmer.search")}
            spellCheck={false}
          />
          {matches.length > 0 && (
            <ul className="map-search-results">
              {matches.map((r) => (
                <li key={r.slug}>
                  <button
                    onClick={() => {
                      setFocus(r.bounds);
                      setQuery("");
                    }}
                  >
                    <strong>{r.label}</strong>
                    <span className="muted">
                      {r.country} · {r.commodity}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <AoiMap
          tree={data.status === "ready" ? data.data.tree : null}
          regions={regions ?? []}
          point={point}
          showLoss={showLoss}
          onPick={pick}
          focus={focus}
        />
        <label className="check">
          <input type="checkbox" checked={showLoss} onChange={(e) => setShowLoss(e.target.checked)} />
          {t("farmer.overlay")}
        </label>
        {uncovered ? (
          <p className="alert bad">{t("farmer.uncovered")}</p>
        ) : (
          <p className="hint">{t("farmer.pinHint", { n: regions?.length ?? 0 })}</p>
        )}
      </section>

      {data.status === "ready" && (
        <>
          <section className="panel">
            <div className="panel-head">
              <span className="panel-num">01</span>
              <span className="panel-title"><MapPin size={16} />{t("farmer.s1")}</span>
            </div>
            {!point && <p className="muted">{t("farmer.noPoint")}</p>}
            {point && cell && (
              <div className="grid2">
                <div>
                  <div className="label">{t("farmer.coords")}</div>
                  <div className="mono">
                    {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
                  </div>
                </div>
                <div>
                  <div className="label">{t("farmer.cell")}</div>
                  <div className="mono">{cell.inside ? t("farmer.cellV", { r: cell.row, c: cell.col }) : t("farmer.outside")}</div>
                </div>
                <div>
                  <div className="label">{t("farmer.statusLabel")}</div>
                  {!cell.inside && <span className="pill">{t("farmer.pill.outside")}</span>}
                  {cell.inside && cellClean && <span className="pill ok">{t("farmer.pill.clean")}</span>}
                  {cell.inside && !cellClean && <span className="pill bad">{t("farmer.pill.loss")}</span>}
                </div>
              </div>
            )}
            {cell?.inside && cellClean === false && <p className="alert bad">{lossMessage}</p>}
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-num">02</span>
              <span className="panel-title"><FileSignature size={16} />{t("farmer.s2")}</span>
            </div>
            <div className="form">
              <label>
                {t("farmer.exporter")}
                <input
                  className="mono"
                  value={exporter}
                  onChange={(e) => setExporter(e.target.value.trim())}
                  placeholder="0x…"
                  spellCheck={false}
                />
                {!exporterValid && exporter && <span className="hint bad">{t("farmer.invalidAddr")}</span>}
              </label>
              <div className="row">
                <label>
                  {t("farmer.season")}
                  <input type="number" value={season} min={2021} max={2100} onChange={(e) => setSeason(Number(e.target.value))} />
                </label>
                <label>
                  {t("farmer.commodity")}
                  <select value={commodityKey} onChange={(e) => setCommodityKey(e.target.value)}>
                    {COMMODITIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {t(`commodity.${c.key}` as Key)} (HS {c.hsCode})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-num">03</span>
              <span className="panel-title"><Cpu size={16} />{t("farmer.s3")}</span>
            </div>
            <button className="btn primary" disabled={!canGenerate} onClick={onGenerate}>
              {proving ? t("farmer.proving") : t("farmer.generate")}
            </button>
            {cell?.inside && cellClean === false && <p className="hint bad">{t("farmer.disabled", { msg: lossMessage })}</p>}
            {proveError && <p className="alert bad">{t("farmer.proofFailed", { msg: proveError })}</p>}
            {proof && proofFile && (
              <div className="proof">
                <p className="alert ok">
                  {t("farmer.proofDone")} <strong>{proof.ms} ms</strong>. {t("farmer.nullifier")}{" "}
                  <span className="mono">{shortHex(proof.nullifier, 8)}</span>
                </p>
                <div className="row" style={{ marginTop: 12 }}>
                  <a className="btn" href={proofFile.url} download={`zkanopy-proof-${proof.nullifier.slice(2, 10)}.json`}>
                    {t("farmer.download")}
                  </a>
                  <button className="btn" onClick={() => navigator.clipboard.writeText(proofFile.contents)}>
                    {t("farmer.copy")}
                  </button>
                </div>
                <details>
                  <summary>{t("farmer.signals")}</summary>
                  <pre className="mono small">
                    {["nullifier", "root", "season", "exporter", "lat0S", "lon0S", "stepS"]
                      .map((k, i) => `${k.padEnd(9)} ${proof.publicSignals[i]}`)
                      .join("\n")}
                  </pre>
                </details>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-num">04</span>
              <span className="panel-title"><Send size={16} />{t("farmer.s4")}</span>
            </div>
            {!address && <p className="muted">{t("farmer.connect")}</p>}
            {address && chainId !== 84532 && <p className="alert warn">{t("farmer.switch")}</p>}
            {address && exporterValid && address.toLowerCase() !== exporter.toLowerCase() && (
              <p className="alert warn">{t("farmer.mismatch", { exporter: shortHex(exporter), wallet: shortHex(address) })}</p>
            )}
            <button className="btn primary" disabled={!proof || !walletReady || submitBusy} onClick={onSubmit} style={{ marginTop: address ? 12 : 0 }}>
              {submit.status === "simulating" ? t("farmer.checking") : submit.status === "pending" ? t("farmer.waiting") : t("farmer.submit")}
            </button>
            {submit.status === "pending" && (
              <p className="alert">
                {t("farmer.sent")} <a href={txUrl(submit.hash)} target="_blank" rel="noreferrer" className="mono">{shortHex(submit.hash, 8)}</a>
              </p>
            )}
            {submit.status === "success" && (
              <p className="alert ok">
                {t("farmer.recorded", { id: submit.id !== null ? `#${submit.id.toString()}` : "" })}{" "}
                <a href={txUrl(submit.hash)} target="_blank" rel="noreferrer" className="mono">{shortHex(submit.hash, 8)}</a>
              </p>
            )}
            {submit.status === "error" && (
              <p className="alert bad">
                <strong className="mono">{submit.error.name}</strong> — {errorText(submit.error)}
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

      <section className="panel privacy">
        <Lock size={14} style={{ verticalAlign: -2, marginRight: 6 }} /><strong>{t("farmer.privacyLabel")}</strong> {t("farmer.privacy")}
      </section>
    </div>
  );
}

function DataStatus({ state }: { state: DataState }) {
  const { t } = useI18n();
  if (state.status === "loading") return <p className="hint">{t("farmer.loading")}</p>;
  if (state.status === "error") return <p className="alert bad">{t("farmer.loadError", { msg: state.message })}</p>;
  const { data, verified, onchainRoot } = state;
  return (
    <p className="hint row" style={{ marginTop: 14 }}>
      <span>
        {t("farmer.status", {
          name: data.tree.name,
          v: data.tree.version,
          rows: data.tree.rows,
          cols: data.tree.cols,
          id: data.record.gridId,
          // The grid is a yearly snapshot, so say which one is being served (improvement 5).
          date: new Date(data.record.publishedAt * 1000).toISOString().slice(0, 10),
        })}{" "}
        <span className="mono">{shortHex(data.record.rootHex)}</span>
      </span>
      {verified ? (
        <span className="pill ok">{t("farmer.verified")}</span>
      ) : onchainRoot === null ? (
        <span className="pill">{t("farmer.unverified")}</span>
      ) : (
        <span className="pill bad">{t("farmer.differs")}</span>
      )}
    </p>
  );
}
