// /flow — the whole process in six steps, one line each. A step (or its node in the strip) opens its short detail.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, FileText, Fingerprint, Satellite, ScanSearch, ShieldCheck, Smartphone, Waypoints } from "lucide-react";
import { useI18n, type Key } from "../i18n";

const STEPS = [Satellite, Smartphone, ShieldCheck, Fingerprint, FileText, ScanSearch];

export default function Flow() {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  const k = (s: string) => s as Key;
  const show = (i: number) => {
    setOpen(i);
    document.getElementById(`step-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="app-page flow-page">
      <header className="page-head">
        <p className="eyebrow">
          <Waypoints size={14} /> {t("flow.eyebrow")}
        </p>
        <h1>
          {t("flow.h")} <em>{t("flow.hEm")}</em>
        </h1>
        <p className="lede">{t("flow.lede")}</p>
      </header>

      <ol className="flow" aria-label={t("flow.h")}>
        {STEPS.map((Icon, i) => (
          <li key={i}>
            <button type="button" className={`flow-node${open === i ? " on" : ""}`} onClick={() => show(i)}>
              <span className="flow-ic">
                <Icon size={18} />
              </span>
              <span className="flow-n">{i + 1}</span>
              <span className="flow-l">{t(k(`flow.fl${i + 1}`))}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="disc-list">
        {STEPS.map((Icon, i) => {
          const isOpen = open === i;
          const id = `step-${i + 1}`;
          return (
            <div className={`disc${isOpen ? " open" : ""}`} id={id} key={id}>
              <button type="button" className="disc-head" aria-expanded={isOpen} aria-controls={`${id}-body`} onClick={() => setOpen(isOpen ? null : i)}>
                <span className="disc-kicker">{t("flow.step", { n: i + 1 })}</span>
                <span className="disc-icon">
                  <Icon size={18} />
                </span>
                <span className="disc-text">
                  <span className="disc-title">{t(k(`flow.s${i + 1}.t`))}</span>
                  <span className="disc-sum">{t(k(`flow.s${i + 1}.s`))}</span>
                </span>
                <ChevronDown size={16} className="disc-chev" aria-hidden="true" />
              </button>
              <div id={`${id}-body`} className="disc-body" inert={!isOpen}>
                <div className="disc-inner">
                  <p>{t(k(`flow.s${i + 1}.d`))}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flow-cta">
        <Link to="/farmer" className="btn primary">
          {t("flow.cta1")} <ArrowRight size={14} className="arrow" />
        </Link>
        <Link to="/verify/1" className="btn ghost">
          {t("flow.cta2")}
        </Link>
      </div>
    </div>
  );
}
