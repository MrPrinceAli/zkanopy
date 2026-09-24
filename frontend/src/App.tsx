import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import SiteHeader from "./components/SiteHeader";
import SiteFooter from "./components/SiteFooter";
import Cursor from "./components/Cursor";
import Landing from "./pages/Landing";
import Farmer from "./pages/Farmer";
import Exporter from "./pages/Exporter";
import Verify from "./pages/Verify";
import Regulator from "./pages/Regulator";
import Flow from "./pages/Flow";
import Field from "./pages/Field";
import { useI18n } from "./i18n";

/** Panels get a border glow that follows the pointer (--mx/--my consumed by .panel::before). */
function useSpotlight() {
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = (e.target as Element | null)?.closest?.(".panel") as HTMLElement | null;
      if (!p) return;
      const r = p.getBoundingClientRect();
      p.style.setProperty("--mx", `${e.clientX - r.left}px`);
      p.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => document.removeEventListener("pointermove", move);
  }, []);
}

export default function App() {
  const { pathname } = useLocation();
  const { t } = useI18n();
  useSpotlight();

  useEffect(() => {
    if (!pathname.startsWith("/verify")) window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="app">
      <Cursor enabled={pathname === "/"} />
      <SiteHeader />
      <main>
        <div key={pathname} className="page-enter">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/farmer" element={<Farmer />} />
            <Route path="/exporter" element={<Exporter />} />
            <Route path="/verify/:id" element={<Verify />} />
            <Route path="/regulator" element={<Regulator />} />
            <Route path="/flow" element={<Flow />} />
            <Route path="/field" element={<Field />} />
            <Route
              path="*"
              element={
                <div className="not-found">
                  <p className="eyebrow">404</p>
                  <h1 style={{ marginTop: 12 }}>{t("common.notFound")}</h1>
                </div>
              }
            />
          </Routes>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
