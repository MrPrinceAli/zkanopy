// 3D tilt: the element rotates a few degrees toward the pointer and eases back when it leaves.
import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { finePointer, reducedMotion } from "../lib/fx";

export default function Tilt({ children, max = 5, className }: { children: ReactNode; max?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !finePointer() || reducedMotion()) return;
    gsap.set(el, { transformPerspective: 1000, transformOrigin: "50% 50%" });
    const rx = gsap.quickTo(el, "rotationX", { duration: 0.6, ease: "power3" });
    const ry = gsap.quickTo(el, "rotationY", { duration: 0.6, ease: "power3" });
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      ry(px * max * 2);
      rx(-py * max * 2);
    };
    const leave = () => {
      rx(0);
      ry(0);
    };
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    return () => {
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mouseleave", leave);
    };
  }, [max]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
