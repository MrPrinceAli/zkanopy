import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Languages, Moon, Sun } from "lucide-react";
import WalletBar from "./WalletBar";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";

const SunIcon = () => <Sun size={16} />;
const MoonIcon = () => <Moon size={16} />;

export default function SiteHeader() {
  const { pathname } = useLocation();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const landing = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        setScrolled(y > 24);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, y / max) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [pathname]);

  const links = [
    { to: "/farmer", label: t("nav.farmer") },
    { to: "/exporter", label: t("nav.exporter") },
    { to: "/regulator", label: t("nav.regulator") },
    { to: "/flow", label: t("nav.flow") },
  ];

  return (
    <header className={`site-header${!landing || scrolled ? " solid" : ""}`}>
      {landing && <i className="progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />}
      <Link to="/" className="wordmark" aria-label="ZKanopy">
        <i />
        ZKanopy
      </Link>
      <nav className="site-nav" aria-label="Roles">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? "active" : "")}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="toggles">
        <button className="tog" onClick={() => setLang(lang === "en" ? "id" : "en")} aria-label={t("header.lang")} title={t("header.lang")}>
          <Languages size={13} />
          <span className={lang === "en" ? "on" : ""}>EN</span>
          <span className="sep">/</span>
          <span className={lang === "id" ? "on" : ""}>ID</span>
        </button>
        <button
          className="tog icon"
          onClick={(e) => toggle({ x: e.clientX, y: e.clientY })}
          aria-label={t(theme === "dark" ? "header.theme.light" : "header.theme.dark")}
          title={t(theme === "dark" ? "header.theme.light" : "header.theme.dark")}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
      <WalletBar />
    </header>
  );
}
