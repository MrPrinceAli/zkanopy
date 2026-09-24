import { Link } from "react-router-dom";
import { REGISTRY_ADDRESS } from "../config";
import { addressUrl } from "../lib/contract";
import { useI18n } from "../i18n";

const REPO = "https://github.com/MrPrinceAli/zkanopy";

export default function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <div className="inner">
        <div>
          <Link to="/" className="wordmark">
            <i />
            ZKanopy
          </Link>
          <p>{t("footer.blurb")}</p>
          <p style={{ marginTop: 12 }}>{t("footer.note")}</p>
        </div>
        <div>
          <h4>{t("footer.roles")}</h4>
          <ul>
            <li>
              <Link to="/farmer">{t("footer.r1")}</Link>
            </li>
            <li>
              <Link to="/exporter">{t("footer.r2")}</Link>
            </li>
            <li>
              <Link to="/verify/1">{t("footer.r3")}</Link>
            </li>
            <li>
              <Link to="/regulator">{t("footer.r4")}</Link>
            </li>
          </ul>
        </div>
        <div>
          <h4>{t("footer.project")}</h4>
          <ul>
            <li>
              <Link to="/flow">{t("footer.flow")}</Link>
            </li>
            <li>
              <Link to="/field">{t("footer.field")}</Link>
            </li>
            <li>
              <a href={REPO} target="_blank" rel="noreferrer">
                {t("footer.p1")}
              </a>
            </li>
            <li>
              <a href={`${REPO}/blob/main/docs/decisions.md`} target="_blank" rel="noreferrer">
                {t("footer.p2")}
              </a>
            </li>
            <li>
              <a href={addressUrl(REGISTRY_ADDRESS)} target="_blank" rel="noreferrer">
                {t("footer.p3")}
              </a>
            </li>
            <li>
              <a href={`${REPO}/blob/main/PRD.md`} target="_blank" rel="noreferrer">
                {t("footer.p4")}
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="footer-mark" aria-hidden="true">
        ZKanopy
      </div>
    </footer>
  );
}
