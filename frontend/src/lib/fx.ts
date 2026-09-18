// Small motion helpers shared by the landing page components.
import { useEffect, useState } from "react";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = () => window.matchMedia("(pointer: fine)").matches;

/** "Decode" effect: random hex characters resolve into `text` over `ms`. Returns the string to render. */
export function useScramble(text: string, active: boolean, ms = 650): string {
  const [out, setOut] = useState(active ? "" : text);
  useEffect(() => {
    if (!active || reducedMotion()) {
      setOut(text);
      return;
    }
    const chars = "0123456789abcdef";
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const n = Math.floor(text.length * p);
      const tail = text
        .slice(n)
        .split("")
        .map((c) => (c === " " ? " " : chars[(Math.random() * 16) | 0]))
        .join("");
      setOut(text.slice(0, n) + tail);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, active, ms]);
  return out;
}

/** True once the element has entered the viewport (never flips back). */
export function useInView<T extends Element>(ref: React.RefObject<T | null>, threshold = 0.3): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}
