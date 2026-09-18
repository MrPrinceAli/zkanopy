// Dark / light theme with a circular reveal on toggle (View Transitions API, instant fallback).
// index.html applies the stored theme before React loads so there is no flash.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

export type Theme = "dark" | "light";
const STORAGE = "zk-theme";

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
}

export function detectTheme(): Theme {
  const cur = document.documentElement.dataset.theme;
  if (cur === "light" || cur === "dark") return cur;
  try {
    const s = localStorage.getItem(STORAGE);
    if (s === "light" || s === "dark") return s;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

interface Ctx {
  theme: Theme;
  toggle: (origin?: { x: number; y: number }) => void;
}

const ThemeContext = createContext<Ctx | null>(null);

type DocWithVT = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(detectTheme);

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(STORAGE, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(
    (origin?: { x: number; y: number }) => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      const doc = document as DocWithVT;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!doc.startViewTransition || reduced) {
        setTheme(next);
        return;
      }
      const x = origin?.x ?? window.innerWidth - 40;
      const y = origin?.y ?? 32;
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const vt = doc.startViewTransition(() => {
        apply(next);
        flushSync(() => setTheme(next));
      });
      vt.ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 700, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", pseudoElement: "::view-transition-new(root)" }
        );
      });
    },
    [theme]
  );

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error("useTheme must be used inside ThemeProvider");
  return c;
}
