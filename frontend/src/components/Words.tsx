// Headline whose words rise out of a mask, one after another, when it scrolls into view.
import { Fragment, createElement, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { reducedMotion } from "../lib/fx";

gsap.registerPlugin(ScrollTrigger);

interface Props {
  text: string;
  em?: string;
  as?: "h1" | "h2" | "h3";
  className?: string;
}

export default function Words({ text, em, as = "h2", className }: Props) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(el.querySelectorAll(".w > span"), {
        yPercent: 110,
        duration: 0.9,
        ease: "power4.out",
        stagger: 0.035,
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    }, el);
    return () => ctx.revert();
  }, [text, em]);

  // The space must live outside the masked inline-block: trailing whitespace inside it collapses away.
  const split = (s: string, prefix: string) =>
    s.split(" ").map((w, i) => (
      <Fragment key={prefix + i}>
        <span className="w">
          <span>{w}</span>
        </span>{" "}
      </Fragment>
    ));

  return createElement(as, { ref, className }, split(text, "t"), em ? createElement("em", { key: "em" }, split(em, "e")) : null);
}
