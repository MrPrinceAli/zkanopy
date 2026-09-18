// Draws the published label grid as pixels: every cell of the real AOI is one pixel of an offscreen image that is
// scaled up without smoothing. Options: scan-in reveal, an ambient loop (cells twinkling, a periodic satellite
// sweep, a glow around the pointer, click pulses), pointer readout and a theme-aware palette.
import { useEffect, useRef, type RefObject } from "react";
import type { Theme } from "../theme";

export interface GridLabels {
  rows: number;
  cols: number;
  labels: string; // row-major, '1' clean, '0' loss; row 0 = southern edge
}

export interface CellHover {
  row: number;
  col: number;
  clean: boolean;
}

interface Props {
  data: GridLabels;
  theme?: Theme;
  reveal?: boolean;
  ambient?: boolean;
  interactive?: boolean;
  /** Element that receives pointer events (defaults to the canvas itself). */
  listenOn?: RefObject<HTMLElement | null>;
  fit?: "cover" | "contain";
  highlight?: { row: number; col: number } | null;
  onHover?: (cell: CellHover | null) => void;
  onSelect?: (cell: CellHover) => void;
  className?: string;
}

const REVEAL_MS = 2600;
const SWEEP_EVERY_MS = 9000;
const SWEEP_MS = 1800;
const SPARK_MS = 900;
const PULSE_MS = 1100;

export type Rgb = [number, number, number];
export const PALETTES: Record<Theme, { bg: string; clean: (n: number) => Rgb; loss: (n: number) => Rgb; glow: string; spark: string; accent: string }> = {
  dark: {
    bg: "#0a0e0c",
    clean: (n) => [20 + n * 24, 46 + n * 44, 30 + n * 22],
    loss: (n) => [222 + n * 28, 138 + n * 34, 66 + n * 30],
    glow: "166,239,94",
    spark: "210,255,170",
    accent: "#a6ef5e",
  },
  light: {
    bg: "#f1ecdf",
    clean: (n) => [138 + n * 40, 178 + n * 36, 140 + n * 30],
    loss: (n) => [210 + n * 24, 122 + n * 40, 58 + n * 40],
    glow: "63,143,47",
    spark: "255,255,240",
    accent: "#3f8f2f",
  },
};

/** Deterministic per-cell noise so the texture is stable between renders. */
export function noise(i: number): number {
  let x = Math.imul(i + 1, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae3d);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function buildImage(data: GridLabels, theme: Theme): HTMLCanvasElement {
  const pal = PALETTES[theme];
  const off = document.createElement("canvas");
  off.width = data.cols;
  off.height = data.rows;
  const ctx = off.getContext("2d")!;
  const img = ctx.createImageData(data.cols, data.rows);
  for (let row = 0; row < data.rows; row++) {
    const y = data.rows - 1 - row;
    for (let col = 0; col < data.cols; col++) {
      const i = row * data.cols + col;
      const [r, g, b] = (data.labels[i] === "1" ? pal.clean : pal.loss)(noise(i));
      const o = (y * data.cols + col) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return off;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export default function GridCanvas({
  data,
  theme = "dark",
  reveal = false,
  ambient = false,
  interactive = false,
  listenOn,
  fit = "cover",
  highlight = null,
  onHover,
  onSelect,
  className,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({
    progress: reveal ? 0 : 1,
    revealed: !reveal,
    hover: null as CellHover | null,
    pointer: null as { x: number; y: number } | null,
    sparks: [] as Array<{ i: number; t0: number }>,
    pulses: [] as Array<{ row: number; col: number; t0: number }>,
    sweepAt: 0,
    revealAt: 0,
    raf: 0,
    running: false,
    visible: true,
  });
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pal = PALETTES[theme];
    const image = buildImage(data, theme);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = st.current;
    if (reduced) {
      s.progress = 1;
      s.revealed = true;
    }
    const live = ambient && !reduced;

    let geom = { w: 0, h: 0, scale: 1, ox: 0, oy: 0 };

    function layout() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.max(1, Math.round(rect.width * dpr));
      canvas!.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx = rect.width / data.cols;
      const sy = rect.height / data.rows;
      const scale = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
      geom = { w: rect.width, h: rect.height, scale, ox: (rect.width - data.cols * scale) / 2, oy: (rect.height - data.rows * scale) / 2 };
    }

    function cellAt(clientX: number, clientY: number): { cell: CellHover | null; x: number; y: number } {
      const rect = canvas!.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const col = Math.floor((x - geom.ox) / geom.scale);
      const fromTop = Math.floor((y - geom.oy) / geom.scale);
      const row = data.rows - 1 - fromTop;
      const inside = col >= 0 && col < data.cols && row >= 0 && row < data.rows;
      return { cell: inside ? { row, col, clean: data.labels[row * data.cols + col] === "1" } : null, x, y };
    }

    function cellRect(cell: { row: number; col: number }) {
      const { scale, ox, oy } = geom;
      return { x: ox + cell.col * scale, y: oy + (data.rows - 1 - cell.row) * scale, s: Math.max(scale, 3) };
    }

    function outline(cell: { row: number; col: number }, strong: boolean) {
      const { x, y, s: size } = cellRect(cell);
      ctx.save();
      ctx.strokeStyle = pal.accent;
      ctx.globalAlpha = strong ? 0.35 : 0.16;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + size / 2);
      ctx.lineTo(geom.w, y + size / 2);
      ctx.moveTo(x + size / 2, 0);
      ctx.lineTo(x + size / 2, geom.h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = strong ? 2 : 1.5;
      ctx.shadowColor = pal.accent;
      ctx.shadowBlur = strong ? 14 : 8;
      ctx.strokeRect(x - 1.5, y - 1.5, size + 3, size + 3);
      ctx.restore();
    }

    function draw(now = performance.now()) {
      const { scale, ox, oy } = geom;
      ctx.clearRect(0, 0, geom.w, geom.h);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, geom.w, geom.h);
      ctx.imageSmoothingEnabled = false;
      const shown = Math.max(0, Math.min(data.rows, Math.floor(easeOut(s.progress) * data.rows)));
      if (shown > 0) ctx.drawImage(image, 0, 0, data.cols, shown, ox, oy, data.cols * scale, shown * scale);

      // scan line during the reveal
      if (s.progress < 1) {
        const y = oy + shown * scale;
        const g = ctx.createLinearGradient(0, y - 60, 0, y);
        g.addColorStop(0, `rgba(${pal.glow},0)`);
        g.addColorStop(1, `rgba(${pal.glow},0.35)`);
        ctx.fillStyle = g;
        ctx.fillRect(ox, y - 60, data.cols * scale, 60);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(ox, y - 1, data.cols * scale, 2);
      }

      if (live && s.progress >= 1) {
        // twinkling cells
        for (let k = s.sparks.length - 1; k >= 0; k--) {
          const sp = s.sparks[k];
          const p = (now - sp.t0) / SPARK_MS;
          if (p >= 1) {
            s.sparks.splice(k, 1);
            continue;
          }
          const row = Math.floor(sp.i / data.cols);
          const col = sp.i % data.cols;
          const { x, y, s: size } = cellRect({ row, col });
          ctx.fillStyle = `rgba(${pal.spark},${0.55 * Math.sin(p * Math.PI)})`;
          ctx.fillRect(x, y, size, size);
        }
        // periodic satellite sweep
        const sinceSweep = now - s.sweepAt;
        if (sinceSweep < SWEEP_MS) {
          const y = oy + (sinceSweep / SWEEP_MS) * data.rows * scale;
          const g = ctx.createLinearGradient(0, y - 90, 0, y);
          g.addColorStop(0, `rgba(${pal.glow},0)`);
          g.addColorStop(1, `rgba(${pal.glow},0.22)`);
          ctx.fillStyle = g;
          ctx.fillRect(ox, y - 90, data.cols * scale, 90);
          ctx.fillStyle = `rgba(${pal.glow},0.7)`;
          ctx.fillRect(ox, y - 0.5, data.cols * scale, 1);
        }
        // glow around the pointer
        if (s.pointer) {
          const g = ctx.createRadialGradient(s.pointer.x, s.pointer.y, 0, s.pointer.x, s.pointer.y, 170);
          g.addColorStop(0, `rgba(${pal.glow},0.16)`);
          g.addColorStop(1, `rgba(${pal.glow},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(s.pointer.x - 170, s.pointer.y - 170, 340, 340);
        }
        // click pulses
        for (let k = s.pulses.length - 1; k >= 0; k--) {
          const pu = s.pulses[k];
          const p = (now - pu.t0) / PULSE_MS;
          if (p >= 1) {
            s.pulses.splice(k, 1);
            continue;
          }
          const { x, y, s: size } = cellRect(pu);
          const cx = x + size / 2;
          const cy = y + size / 2;
          ctx.save();
          ctx.strokeStyle = pal.accent;
          ctx.globalAlpha = (1 - p) * 0.9;
          ctx.lineWidth = 2 - p;
          ctx.beginPath();
          ctx.arc(cx, cy, size / 2 + easeOut(p) * size * 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (highlightRef.current) outline(highlightRef.current, true);
      if (s.hover) outline(s.hover, false);
    }
    drawRef.current = () => draw();

    function loop(now: number) {
      if (!s.running) return;
      if (s.progress < 1) {
        if (!s.revealAt) s.revealAt = now;
        s.progress = Math.min(1, (now - s.revealAt) / REVEAL_MS);
        if (s.progress >= 1) s.sweepAt = now; // first satellite sweep SWEEP_EVERY_MS after the reveal
      }
      if (live && s.progress >= 1) {
        if (s.sparks.length < 70 && Math.random() < 0.55) s.sparks.push({ i: (Math.random() * data.labels.length) | 0, t0: now });
        if (!s.sweepAt) s.sweepAt = now;
        if (now - s.sweepAt > SWEEP_EVERY_MS) s.sweepAt = now;
      }
      draw(now);
      if (s.progress < 1 || live) s.raf = requestAnimationFrame(loop);
      else s.running = false;
    }

    function start() {
      if (s.running || !s.visible || document.hidden) return;
      if (s.progress >= 1 && !live) {
        draw();
        return;
      }
      s.running = true;
      s.raf = requestAnimationFrame(loop);
    }
    function stop() {
      s.running = false;
      cancelAnimationFrame(s.raf);
    }

    layout();
    if (s.revealed) s.progress = 1;
    s.revealed = true; // a theme change must not replay the scan-in
    draw();
    start();

    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      s.visible = e.isIntersecting;
      if (s.visible) start();
      else stop();
    });
    io.observe(canvas);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);

    const target = (listenOn?.current ?? canvas) as HTMLElement;
    const move = (e: PointerEvent) => {
      const { cell, x, y } = cellAt(e.clientX, e.clientY);
      s.pointer = { x, y };
      const prev = s.hover;
      if ((cell?.row ?? -1) !== (prev?.row ?? -1) || (cell?.col ?? -1) !== (prev?.col ?? -1)) {
        s.hover = cell;
        onHoverRef.current?.(cell);
      }
      if (!s.running) draw();
    };
    const leave = () => {
      s.pointer = null;
      if (s.hover) {
        s.hover = null;
        onHoverRef.current?.(null);
      }
      if (!s.running) draw();
    };
    const click = (e: PointerEvent) => {
      if ((e.target as Element).closest("a, button, input, select, label")) return;
      const { cell } = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      s.pulses.push({ ...cell, t0: performance.now() });
      onSelectRef.current?.(cell);
      if (!s.running) draw();
    };
    if (interactive) {
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerleave", leave);
      target.addEventListener("pointerdown", click);
    }

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
      if (interactive) {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerleave", leave);
        target.removeEventListener("pointerdown", click);
      }
    };
  }, [data, theme, reveal, ambient, interactive, listenOn, fit]);

  useEffect(() => {
    drawRef.current();
  }, [highlight]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
