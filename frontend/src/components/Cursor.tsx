// Custom cursor for the landing page: a dot that follows instantly and a ring that lags and grows over links.
// Only on fine pointers, never with reduced motion; the native cursor is hidden via html.has-cursor.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { finePointer, reducedMotion } from "../lib/fx";

export default function Cursor({ enabled }: { enabled: boolean }) {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !finePointer() || reducedMotion() || !dot.current || !ring.current) return;
    const root = document.documentElement;
    root.classList.add("has-cursor");
    const xr = gsap.quickTo(ring.current, "x", { duration: 0.3, ease: "power3" });
    const yr = gsap.quickTo(ring.current, "y", { duration: 0.3, ease: "power3" });
    const xd = gsap.quickTo(dot.current, "x", { duration: 0.06 });
    const yd = gsap.quickTo(dot.current, "y", { duration: 0.06 });
    const move = (e: MouseEvent) => {
      xr(e.clientX);
      yr(e.clientY);
      xd(e.clientX);
      yd(e.clientY);
      const hot = !!(e.target as Element | null)?.closest?.("a, button, [data-cursor], input, select, label, summary");
      ring.current!.classList.toggle("is-active", hot);
      root.classList.add("cursor-seen");
    };
    const leave = () => root.classList.remove("cursor-seen");
    window.addEventListener("mousemove", move, { passive: true });
    document.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", move);
      document.removeEventListener("mouseleave", leave);
      root.classList.remove("has-cursor", "cursor-seen");
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <div ref={dot} className="cursor-dot" aria-hidden="true" />
      <div ref={ring} className="cursor-ring" aria-hidden="true">
        <i />
      </div>
    </>
  );
}
