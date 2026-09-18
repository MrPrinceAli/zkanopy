// Landing page as a seven-chapter story, driven by scroll and drawn from the real published data.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { usePublicClient } from "wagmi";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Copy,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Fingerprint,
  Flame,
  Grid3x3,
  Link2,
  Lock,
  MapPin,
  Radar as RadarIcon,
  Satellite,
  ScanLine,
  Sprout,
  Timer,
  Trees,
  Users,
} from "lucide-react";
import GridCanvas, { type CellHover } from "../components/GridCanvas";
import TimelineCanvas, { type TimelineHandle } from "../components/TimelineCanvas";
import Phone from "../components/Phone";
import Radar from "../components/Radar";
import FlipCard from "../components/FlipCard";
import ChapterNav from "../components/ChapterNav";
import Marquee from "../components/Marquee";
import Magnetic from "../components/Magnetic";
import Tilt from "../components/Tilt";
import Words from "../components/Words";
import { fmt, loadChainStats, loadLabels, loadMetadata, relativeTime, type ChainStats, type GridMetadata, type LabelsFile } from "../lib/landing";
import { loadRisk, riskClass, type RiskFile } from "../lib/risk";
import { addressUrl, shortHex, txUrl } from "../lib/contract";
import { commodityFromHash } from "../lib/registry";
import { finePointer, reducedMotion, useInView, useScramble } from "../lib/fx";
import { useI18n, type Key } from "../i18n";
import { useTheme } from "../theme";
import { REGISTRY_ADDRESS, VERIFIER_ADDRESS } from "../config";

gsap.registerPlugin(ScrollTrigger);

// Attestation #1 (cell 100,100 of the published grid) — real values, used as the worked example.
const EXAMPLE = {
  id: 1,
  exporter: "0x9584D49c674F685D6CD3463D9beBCfF3d8b68923",
  nullifier: "0x1748332d83dfacf42e3d337f6566d74ad241c8cad10aa994c90b0e2060ffdeb8",
  root: "0x09f5f689848d7550839292c2dbefda79081c31a9f77a8384973437713bc9ad7a",
  season: 2026,
  lat0S: 94_550_000,
  lon0S: 276_750_000,
  stepS: 900,
  lat: "4.640536",
  lon: "96.840448",
};

const STEPS = [
  { t: "how.s1.t", p: "how.s1.p", Icon: Satellite },
  { t: "how.s2.t", p: "how.s2.p", Icon: MapPin },
  { t: "how.s3.t", p: "how.s3.p", Icon: Cpu },
  { t: "how.s4.t", p: "how.s4.p", Icon: Fingerprint },
] as const;

function Counter({ value, format = fmt }: { value: number | null; format?: (n: number) => string }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (value === null || !el) return;
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / 1500);
          setShown(value * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return <b ref={ref}>{value === null ? "—" : format(shown)}</b>;
}

/** Redacted value that can be peeked at: it decodes from hex noise while hovered and re-redacts on leave. */
function Redact({ value, title }: { value: string; title: string }) {
  const [peek, setPeek] = useState(false);
  const shown = useScramble(value, peek);
  return (
    <span className={`redact${peek ? " peek" : ""}`} onPointerEnter={() => setPeek(true)} onPointerLeave={() => setPeek(false)} title={title}>
      {peek ? shown : value}
    </span>
  );
}

function RiskBar({ value }: { value: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.5);
  const cls = riskClass(value) === "bad" ? "hot" : riskClass(value) === "warn" ? "warm" : "";
  return (
    <div className="bar" ref={ref}>
      <i className={cls} style={{ width: seen ? `${Math.max(3, value * 100)}%` : 0 }} />
    </div>
  );
}

export default function Landing() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const publicClient = usePublicClient();
  const root = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const timeline = useRef<TimelineHandle>(null);
  const yearRef = useRef<HTMLSpanElement>(null);
  const lineRef = useRef<HTMLElement>(null);
  const countRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<LabelsFile | null>(null);
  const [meta, setMeta] = useState<GridMetadata | null>(null);
  const [risk, setRisk] = useState<RiskFile | null>(null);
  const [chain, setChain] = useState<ChainStats | null>(null);
  const [hover, setHover] = useState<CellHover | null>(null);
  const [picked, setPicked] = useState<CellHover | null>(null);
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);
  const eyebrow = useScramble(t("hero.eyebrow"), true, 1000);

  useEffect(() => {
    loadLabels().then(setLabels).catch(() => setLabels(null));
    loadMetadata().then(setMeta).catch(() => setMeta(null));
    loadRisk().then(setRisk).catch(() => setRisk(null));
  }, []);

  useEffect(() => {
    if (!publicClient) return;
    loadChainStats(publicClient).then(setChain).catch(() => setChain(null));
  }, [publicClient]);

  // Async data changes section heights: let ScrollTrigger recompute pins and triggers.
  useEffect(() => {
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 60);
    return () => window.clearTimeout(id);
  }, [labels, meta, risk, chain]);

  // Scroll choreography: hero, pinned timeline, horizontal "watchers" strip, reveals.
  useLayoutEffect(() => {
    const mm = gsap.matchMedia(root.current ?? undefined);
    // Every viewport must match one condition, otherwise the callback (pins, reveals) never runs.
    mm.add({ desktop: "(min-width: 901px)", mobile: "(max-width: 900px)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
      const { desktop, reduce } = ctx.conditions as { desktop: boolean; mobile: boolean; reduce: boolean };
      if (reduce) {
        gsap.set(".reveal", { opacity: 1, y: 0 });
        if (yearRef.current) yearRef.current.textContent = "2025";
        if (lineRef.current) lineRef.current.style.transform = "scaleX(1)";
        timeline.current?.setProgress(1);
        return;
      }
      gsap.to(".line-in", { y: 0, duration: 1.2, ease: "power4.out", stagger: 0.11, delay: 0.15 });
      gsap.from([".hero-lede", ".hero-cta", ".stat-strip"], { opacity: 0, y: 22, duration: 1, ease: "power3.out", stagger: 0.1, delay: 0.7 });
      gsap.to(".hero-canvas", { yPercent: 14, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
      gsap.to(".hero-copy", { yPercent: -10, opacity: 0.1, ease: "none", scrollTrigger: { trigger: ".hero", start: "40% top", end: "bottom top", scrub: true } });
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
        gsap.to(el, { opacity: 1, y: 0, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>(".fact .num").forEach((el, i) => {
        gsap.from(el, { yPercent: 40, opacity: 0, duration: 1, delay: i * 0.1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
      });

      // Chapter 1: pinned, scrubbed timeline 2020 -> 2025
      ScrollTrigger.create({
        trigger: ".story",
        start: "top top",
        end: "+=260%",
        pin: ".story-pin",
        scrub: 0.5,
        anticipatePin: 1,
        onUpdate: (self) => {
          const p = self.progress;
          timeline.current?.setProgress(p);
          if (yearRef.current) yearRef.current.textContent = String(2020 + Math.min(5, Math.floor(p * 5.999)));
          if (lineRef.current) lineRef.current.style.transform = `scaleX(${p})`;
        },
      });

      // Chapter 5: horizontal strip on desktop
      const track = trackRef.current;
      if (desktop && track) {
        const distance = () => Math.max(0, track.scrollWidth - track.clientWidth);
        gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: ".ai-x",
            start: "top top",
            end: () => "+=" + distance(),
            pin: ".ai-pin",
            scrub: 0.6,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
      }
      ScrollTrigger.refresh();
    });
    return () => mm.revert();
  }, [lang]);

  // Subtle pointer parallax on the hero copy.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || !finePointer() || reducedMotion()) return;
    const xTo = gsap.quickTo(".hero-copy", "x", { duration: 0.9, ease: "power3" });
    const yTo = gsap.quickTo(".hero-copy", "y", { duration: 0.9, ease: "power3" });
    const move = (e: MouseEvent) => {
      xTo((e.clientX / window.innerWidth - 0.5) * -14);
      yTo((e.clientY / window.innerHeight - 0.5) * -10);
    };
    hero.addEventListener("mousemove", move);
    return () => hero.removeEventListener("mousemove", move);
  }, []);

  // Which "your plot" step is in view drives the phone screen.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = window.innerHeight * 0.55;
      let idx = 0;
      stepRefs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= mid) idx = i;
      });
      setActive((prev) => (prev === idx ? prev : idx));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const ai = meta?.labeling.ai;
  const marqueeItems = (["mq.1", "mq.2", "mq.3", "mq.4", "mq.5"] as const).map((k) => t(k));
  const chapters = [
    { id: "top", label: t("chap.hero") },
    { id: "story", label: t("chap.story") },
    { id: "problem", label: t("chap.problem") },
    { id: "how", label: t("chap.how") },
    { id: "privacy", label: t("chap.privacy") },
    { id: "ai", label: t("chap.ai") },
    { id: "live", label: t("chap.live") },
    { id: "start", label: t("chap.start") },
  ];
  const paperCanvasTheme = theme === "dark" ? "light" : "dark";

  const seenLedger = (
    <div className="ledger">
      <div>
        <span>{t("privacy.k.nullifier")}</span>
        <span>{EXAMPLE.nullifier}</span>
      </div>
      <div>
        <span>{t("privacy.k.root")}</span>
        <span>{EXAMPLE.root}</span>
      </div>
      <div>
        <span>{t("privacy.k.season")}</span>
        <span>{EXAMPLE.season}</span>
      </div>
      <div>
        <span>{t("privacy.k.exporter")}</span>
        <span>{EXAMPLE.exporter}</span>
      </div>
      <div>
        <span>{t("privacy.k.grid")}</span>
        <span>
          lat0S {EXAMPLE.lat0S} · lon0S {EXAMPLE.lon0S} · stepS {EXAMPLE.stepS}
        </span>
      </div>
      <div>
        <span>{t("privacy.k.commodity")}</span>
        <span>{t("privacy.commodityV")}</span>
      </div>
    </div>
  );

  const keptLedger = (
    <div className="ledger">
      <div>
        <span>{t("privacy.k.lat")}</span>
        <span>
          <Redact value={EXAMPLE.lat} title={t("privacy.peek")} />
        </span>
      </div>
      <div>
        <span>{t("privacy.k.lon")}</span>
        <span>
          <Redact value={EXAMPLE.lon} title={t("privacy.peek")} />
        </span>
      </div>
      <div>
        <span>{t("privacy.k.cell")}</span>
        <span>
          <Redact value={t("privacy.cellV")} title={t("privacy.peek")} />
        </span>
      </div>
      <div>
        <span>{t("privacy.k.path")}</span>
        <span>
          <Redact value={t("privacy.pathV")} title={t("privacy.peek")} />
        </span>
      </div>
      <div>
        <span>{t("privacy.k.witness")}</span>
        <span>{t("privacy.witnessV")}</span>
      </div>
    </div>
  );

  return (
    <div ref={root} className="landing">
      <ChapterNav chapters={chapters} />

      {/* ------------------------------------------------------- chapter 0 */}
      <section className="hero" id="top" ref={heroRef} data-cursor="grid">
        {labels && (
          <GridCanvas data={labels} theme={theme} reveal ambient interactive listenOn={heroRef} onHover={setHover} onSelect={setPicked} className="hero-canvas" />
        )}
        <div className="hero-veil" />
        <div className="hero-readout" aria-live="polite">
          {hover ? (
            <>
              row {hover.row} · col {hover.col} · <b className={hover.clean ? "" : "loss"}>{hover.clean ? t("hero.clean") : t("hero.loss")}</b>
            </>
          ) : (
            t("hero.idle1")
          )}
          <br />
          {picked ? (
            <>
              ({picked.row}, {picked.col}) · {picked.clean ? t("hero.picked.clean") : t("hero.picked.loss")}
              {picked.clean && (
                <>
                  {" "}
                  <Link to="/farmer">{t("hero.picked.cta")}</Link>
                </>
              )}
            </>
          ) : (
            t("hero.idle2")
          )}
        </div>
        <div className="hero-copy">
          <p className="eyebrow">
            <Sprout size={14} /> {eyebrow}
          </p>
          <h1 style={{ marginTop: 18 }}>
            <span className="line">
              <span className="line-in">{t("hero.l1")}</span>
            </span>
            <span className="line">
              <span className="line-in">{t("hero.l2")}</span>
            </span>
            <span className="line">
              <span className="line-in">
                <em>{t("hero.l3")}</em>
              </span>
            </span>
          </h1>
          <p className="hero-lede">{t("hero.lede")}</p>
          <div className="hero-cta">
            <Magnetic>
              <Link className="btn primary" to="/farmer">
                {t("hero.cta1")} <ArrowRight size={14} className="arrow" />
              </Link>
            </Magnetic>
            <Magnetic>
              <a className="btn" href="#story">
                {t("hero.cta2")} <ArrowDown size={14} className="arrow" />
              </a>
            </Magnetic>
          </div>
          <div className="stat-strip">
            <div className="stat">
              <Grid3x3 size={16} />
              <Counter value={meta ? meta.tree.cells : labels ? labels.rows * labels.cols : null} />
              <span>{t("hero.stat.cells")}</span>
            </div>
            <div className="stat">
              <Flame size={16} />
              <Counter value={meta ? meta.tree.loss : null} />
              <span>{t("hero.stat.flagged")}</span>
            </div>
            <div className="stat">
              <Link2 size={16} />
              <Counter value={chain ? chain.attestations : null} />
              <span>{t("hero.stat.att")}</span>
            </div>
            <div className="stat">
              <Timer size={16} />
              <b>0.5 s</b>
              <span>{t("hero.stat.prove")}</span>
            </div>
          </div>
        </div>
        <div className="scroll-cue">{t("hero.scroll")}</div>
      </section>

      <Marquee items={marqueeItems} />

      {/* ------------------------------------------------------- chapter 1 */}
      <section className="chapter story cine" id="story">
        <div className="story-pin">
          <div className="container story-grid">
            <div className="story-copy">
              <p className="eyebrow">
                <Satellite size={14} /> {t("story.eyebrow")}
              </p>
              <div className="year">
                <span ref={yearRef}>2020</span>
              </div>
              <div className="story-line">
                <i ref={lineRef} />
              </div>
              <h2 className="story-h">{t("story.h")}</h2>
              <p className="lede">{t("story.p")}</p>
              <div className="story-stat">
                <b ref={countRef}>0</b>
                <span>{t("story.count")}</span>
              </div>
              <p className="hint small">{t("story.note")}</p>
            </div>
            <div className="story-visual">
              {labels && (
                <TimelineCanvas
                  ref={timeline}
                  data={labels}
                  theme="dark"
                  className="story-canvas"
                  onCount={(k) => {
                    if (countRef.current) countRef.current.textContent = fmt(k);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- chapter 2 */}
      <section className="section chapter paper" id="problem">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow reveal">{t("problem.eyebrow")}</p>
            <Words text={t("problem.h")} em={t("problem.hEm")} />
            <p className="lede reveal">{t("problem.lede")}</p>
          </div>
          <div className="facts">
            {(
              [
                ["f1", MapPin],
                ["f2", Database],
                ["f3", Copy],
              ] as const
            ).map(([f, Icon], i) => (
              <div className="fact reveal" key={f}>
                <div className="num">0{i + 1}</div>
                <div className="fact-icon">
                  <Icon size={22} />
                </div>
                <h3>{t(`problem.${f}.t` as Key)}</h3>
                <p>{t(`problem.${f}.p` as Key)}</p>
              </div>
            ))}
          </div>
          <p className="pullquote reveal">{t("problem.quote")}</p>
        </div>
      </section>

      {/* ------------------------------------------------------- chapter 3 */}
      <section className="section chapter" id="how">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow reveal">{t("how.eyebrow")}</p>
            <Words text={t("how.h")} em={t("how.hEm")} />
          </div>
          <div className="steps">
            <div className="steps-visual">
              <Tilt max={4} className="phone-tilt">
                <Phone step={active} labels={labels} theme={theme} />
              </Tilt>
            </div>
            <div className="steps-list">
              {STEPS.map((s, i) => (
                <div
                  key={s.t}
                  className={`step${active === i ? " active" : ""}`}
                  data-step={i}
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                >
                  <div className="num">
                    <s.Icon size={15} /> 0{i + 1}
                  </div>
                  <h3>{t(s.t)}</h3>
                  <p>{t(s.p)}</p>
                  <div className="inline-visual">
                    <Phone step={i} labels={labels} theme={theme} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- chapter 4 */}
      <section className="section chapter privacy-x cine" id="privacy">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow reveal">
              <Lock size={14} /> {t("privacy.eyebrow")}
            </p>
            <Words text={t("privacy.h")} em={t("privacy.hEm")} />
            <p className="lede reveal">{t("privacy.lede")}</p>
          </div>
          <div className="privacy-grid">
            <div className="reveal">
              <FlipCard
                hint={t("privacy.flip")}
                front={
                  <div className="face-inner">
                    <p className="eyebrow">
                      <Eye size={14} /> {t("privacy.front")}
                    </p>
                    {seenLedger}
                  </div>
                }
                back={
                  <div className="face-inner">
                    <p className="eyebrow">
                      <EyeOff size={14} /> {t("privacy.back")}
                    </p>
                    {keptLedger}
                    <p className="hint small">{t("privacy.peek")}</p>
                  </div>
                }
              />
            </div>
            <div className="netlist reveal">
              <p className="eyebrow">
                <ScanLine size={14} /> {t("privacy.net")}
              </p>
              <ul>
                {(["net.1", "net.2", "net.3", "net.4"] as const).map((k) => (
                  <li key={k}>
                    <Check size={14} />
                    <span>{t(k)}</span>
                  </li>
                ))}
              </ul>
              <p className="net-none">
                <Lock size={14} /> {t("net.none")}
              </p>
              <p className="hint" style={{ marginTop: 16 }}>
                {t("privacy.note")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- chapter 5 */}
      <section className="chapter ai-x" id="ai">
        <div className="ai-pin">
          <div className="container ai-head">
            <p className="eyebrow">
              <RadarIcon size={14} /> {t("ai.eyebrow")}
            </p>
            <h2>
              {t("ai.h")} <em>{t("ai.hEm")}</em>
            </h2>
            <p className="lede">{t("ai.lede")}</p>
          </div>
          <div className="ai-track" ref={trackRef}>
            <article className="ai-panel">
              <p className="eyebrow">
                <Trees size={14} /> {t("ai.p1.k")}
              </p>
              <h3>{t("ai.p1.t")}</h3>
              <p className="lede">{t("ai.m1.p")}</p>
              <div>
                <div className="metric">
                  <span>{t("ai.m1.acc")}</span>
                  <b>{ai?.metrics ? ai.metrics.accuracy.toFixed(3) : "—"}</b>
                </div>
                <div className="metric">
                  <span>{t("ai.m1.f1")}</span>
                  <b>{ai?.metrics ? ai.metrics.f1_loss.toFixed(3) : "—"}</b>
                </div>
                <div className="metric">
                  <span>{t("ai.m1.veto")}</span>
                  <b>{ai ? fmt(ai.disagreement.hansen_clean_ai_loss) : "—"}</b>
                </div>
                <div className="metric">
                  <span>{t("ai.m1.final")}</span>
                  <b>{meta ? t("ai.m1.finalV", { clean: fmt(meta.tree.clean), loss: fmt(meta.tree.loss) }) : "—"}</b>
                </div>
              </div>
            </article>
            <article className="ai-panel">
              <p className="eyebrow">
                <RadarIcon size={14} /> {t("ai.p2.k")}
              </p>
              <h3>{t("ai.p2.t")}</h3>
              <p className="lede">{t("ai.m2.p")}</p>
              <div className="ai-split">
                {risk ? <Radar exporters={risk.exporters} caption={t("ai.radar")} /> : <p className="muted">{t("ai.m2.none")}</p>}
                <div>
                  {risk?.exporters.map((e) => (
                    <div className="risk-row" key={e.address}>
                      <a href={addressUrl(e.address)} target="_blank" rel="noreferrer">
                        {shortHex(e.address, 4)}
                      </a>
                      <RiskBar value={e.risk_score} />
                      <span>{e.risk_score.toFixed(2)}</span>
                    </div>
                  ))}
                  <p className="hint">
                    <Link to="/regulator">{t("ai.m2.link")}</Link>
                  </p>
                </div>
              </div>
            </article>
            <article className="ai-panel">
              <p className="eyebrow">
                <Users size={14} /> {t("ai.p3.k")}
              </p>
              <h3>{t("ai.p3.t")}</h3>
              <p className="lede">{t("ai.p3.p")}</p>
              <div className="big-stat">
                <b>{ai ? fmt(ai.disagreement.total) : "—"}</b>
                <span>{t("ai.p3.count")}</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- chapter 6 */}
      <section className="section chapter live" id="live">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow reveal">
              <Link2 size={14} /> {t("live.eyebrow")}
            </p>
            <Words text={t("live.h")} em={t("live.hEm")} />
          </div>
          <div className="feed reveal">
            <div className="feed-row head">
              <span>{t("live.id")}</span>
              <span>{t("live.exporter")}</span>
              <span className="hide-m">{t("live.commodity")}</span>
              <span className="hide-m">{t("live.season")}</span>
              <span>{t("live.when")}</span>
              <span className="hide-m">{t("live.tx")}</span>
            </div>
            {chain === null && <div className="feed-row">{t("live.reading")}</div>}
            {chain && chain.latest.length === 0 && <div className="feed-row">{t("live.none")}</div>}
            {chain?.latest.map((a, i) => (
              <div className="feed-row in" key={a.id.toString()} style={{ "--i": i } as CSSProperties}>
                <Link to={`/verify/${a.id}`}>#{a.id.toString()}</Link>
                <a href={addressUrl(a.exporter)} target="_blank" rel="noreferrer">
                  {shortHex(a.exporter, 5)}
                </a>
                <span className="hide-m">{t(`commodity.${commodityFromHash(a.commodityHash).key}` as Key)}</span>
                <span className="hide-m">{a.season}</span>
                <span>{relativeTime(a.timestamp, t)}</span>
                {a.txHash ? (
                  <a className="hide-m" href={txUrl(a.txHash)} target="_blank" rel="noreferrer">
                    {shortHex(a.txHash, 3)}
                  </a>
                ) : (
                  <span className="hide-m">—</span>
                )}
              </div>
            ))}
          </div>
          <div className="addr-block reveal">
            <div className="panel">
              <div className="label">{t("live.registry")}</div>
              <a className="mono" href={addressUrl(REGISTRY_ADDRESS)} target="_blank" rel="noreferrer">
                {REGISTRY_ADDRESS}
              </a>
              <div className="label" style={{ marginTop: 14 }}>
                {t("live.verifier")}
              </div>
              <a className="mono" href={addressUrl(VERIFIER_ADDRESS)} target="_blank" rel="noreferrer">
                {VERIFIER_ADDRESS}
              </a>
            </div>
            <div className="panel">
              <div className="label">
                {t("live.root")} · {meta ? `${meta.name} v${meta.version}` : "gayo-aceh-coffee"}
              </div>
              <span className="mono">{meta ? meta.tree.rootHex : EXAMPLE.root}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- chapter 7 */}
      <section className="section chapter start paper" id="start">
        <div className="container start-grid">
          <div>
            <p className="eyebrow reveal">
              <Sprout size={14} /> {t("start.eyebrow")}
            </p>
            <Words text={t("start.h")} em={t("start.hEm")} />
            <p className="lede reveal" style={{ marginTop: 18 }}>
              {t("start.p")}
            </p>
            <div className="hero-cta reveal">
              <Magnetic>
                <Link className="btn primary" to="/farmer">
                  {t("start.cta")} <ArrowRight size={14} className="arrow" />
                </Link>
              </Magnetic>
              <Magnetic>
                <Link className="btn" to="/verify/1">
                  {t("start.cta2")}
                </Link>
              </Magnetic>
            </div>
          </div>
          <div className="start-window reveal">{labels && <GridCanvas data={labels} theme={paperCanvasTheme} fit="cover" interactive className="start-canvas" />}</div>
        </div>
      </section>
    </div>
  );
}
