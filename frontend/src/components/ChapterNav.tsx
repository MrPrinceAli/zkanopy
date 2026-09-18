// Chapter dots on the right edge of the landing page; the active one follows the scroll position.
import { useEffect, useState } from "react";

export interface Chapter {
  id: string;
  label: string;
}

export default function ChapterNav({ chapters }: { chapters: Chapter[] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = window.innerHeight * 0.4;
      let idx = 0;
      chapters.forEach((c, i) => {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top <= mid) idx = i;
      });
      setActive(idx);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [chapters]);

  return (
    <nav className="chapters" aria-label="Chapters">
      {chapters.map((c, i) => (
        <a key={c.id} href={`#${c.id}`} className={i === active ? "active" : ""} aria-current={i === active ? "true" : undefined}>
          <i />
          <span>{c.label}</span>
        </a>
      ))}
    </nav>
  );
}
