// Endless ticker; the track is duplicated so the CSS loop is seamless. Pauses on hover.
import type { ReactNode } from "react";

export default function Marquee({ items, className = "" }: { items: ReactNode[]; className?: string }) {
  const row = (prefix: string) =>
    items.map((it, i) => (
      <span className="mq-item" key={prefix + i}>
        {it}
        <i />
      </span>
    ));
  return (
    <div className={`marquee ${className}`} aria-hidden="true">
      <div className="mq-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}
