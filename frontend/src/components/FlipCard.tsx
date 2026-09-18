// 3D flip card: hover on fine pointers, tap elsewhere.
import { useState, type ReactNode } from "react";

export default function FlipCard({ front, back, hint }: { front: ReactNode; back: ReactNode; hint: string }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      className={`flip${flipped ? " is-flipped" : ""}`}
      onMouseEnter={() => window.matchMedia("(pointer: fine)").matches && setFlipped(true)}
      onMouseLeave={() => window.matchMedia("(pointer: fine)").matches && setFlipped(false)}
      onClick={() => setFlipped((f) => !f)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setFlipped((f) => !f)}
      aria-label={hint}
      data-cursor="flip"
    >
      <div className="flip-inner">
        <div className="flip-face front">{front}</div>
        <div className="flip-face back">{back}</div>
      </div>
      <span className="flip-hint">{hint}</span>
    </div>
  );
}
