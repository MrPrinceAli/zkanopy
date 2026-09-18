// Scroll-scrubbed "2020 → 2025" scene: every cell starts green; flagged cells turn amber one by one as
// progress goes from 0 to 1 (order is a seeded shuffle — illustrative, the grid stores only final labels).
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Theme } from "../theme";
import { PALETTES, noise, type GridLabels } from "./GridCanvas";

export interface TimelineHandle {
  setProgress: (p: number) => void;
}

interface Props {
  data: GridLabels;
  theme?: Theme;
  className?: string;
  onCount?: (flagged: number, total: number) => void;
}

function shuffledLossOrder(data: GridLabels): Uint32Array {
  const idx: number[] = [];
  for (let i = 0; i < data.labels.length; i++) if (data.labels[i] === "0") idx.push(i);
  let seed = 7;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return Uint32Array.from(idx);
}

const TimelineCanvas = forwardRef<TimelineHandle, Props>(function TimelineCanvas({ data, theme = "dark", className, onCount }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef({ progress: 0, raf: 0, lastK: -1, draw: () => {} });
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pal = PALETTES[theme];

    const base = document.createElement("canvas");
    base.width = data.cols;
    base.height = data.rows;
    const bctx = base.getContext("2d")!;
    const img = bctx.createImageData(data.cols, data.rows);
    for (let row = 0; row < data.rows; row++) {
      const y = data.rows - 1 - row;
      for (let col = 0; col < data.cols; col++) {
        const i = row * data.cols + col;
        const [r, g, b] = pal.clean(noise(i));
        const o = (y * data.cols + col) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    const order = shuffledLossOrder(data);
    const lossColors = Array.from(order, (i) => {
      const [r, g, b] = pal.loss(noise(i));
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    });

    let geom = { w: 0, h: 0, scale: 1, ox: 0, oy: 0 };
    function layout() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.max(1, Math.round(rect.width * dpr));
      canvas!.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(rect.width / data.cols, rect.height / data.rows);
      geom = { w: rect.width, h: rect.height, scale, ox: (rect.width - data.cols * scale) / 2, oy: (rect.height - data.rows * scale) / 2 };
    }

    function draw() {
      const { scale, ox, oy } = geom;
      const k = Math.round(st.current.progress * order.length);
      ctx.clearRect(0, 0, geom.w, geom.h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(base, 0, 0, data.cols, data.rows, ox, oy, data.cols * scale, data.rows * scale);
      const s = Math.max(scale, 1);
      for (let n = 0; n < k; n++) {
        const i = order[n];
        const row = Math.floor(i / data.cols);
        const col = i % data.cols;
        ctx.fillStyle = lossColors[n];
        ctx.fillRect(ox + col * scale, oy + (data.rows - 1 - row) * scale, s, s);
      }
      // the most recent cells flash brighter, like fresh clearings
      for (let n = Math.max(0, k - 40); n < k; n++) {
        const i = order[n];
        const row = Math.floor(i / data.cols);
        const col = i % data.cols;
        const a = ((n - (k - 40)) / 40) * 0.7;
        ctx.fillStyle = `rgba(${pal.spark},${a})`;
        ctx.fillRect(ox + col * scale - 1, oy + (data.rows - 1 - row) * scale - 1, s + 2, s + 2);
      }
      if (k !== st.current.lastK) {
        st.current.lastK = k;
        onCountRef.current?.(k, order.length);
      }
    }
    st.current.draw = draw;

    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(canvas);
    layout();
    draw();
    return () => ro.disconnect();
  }, [data, theme]);

  useImperativeHandle(
    ref,
    () => ({
      setProgress(p: number) {
        st.current.progress = Math.max(0, Math.min(1, p));
        if (!st.current.raf) {
          st.current.raf = requestAnimationFrame(() => {
            st.current.raf = 0;
            st.current.draw();
          });
        }
      },
    }),
    []
  );

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
});

export default TimelineCanvas;
