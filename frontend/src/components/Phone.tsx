// A phone mock-up that walks through the farmer app: map → cell → proving → attested.
// Screens share the `.layer` transition used by the old sticky frame, so the same step index drives them.
import { Check, Cpu, MapPin, ShieldCheck } from "lucide-react";
import GridCanvas, { type GridLabels } from "./GridCanvas";
import CellZoom from "./CellZoom";
import { useI18n } from "../i18n";
import type { Theme } from "../theme";

interface Props {
  step: number;
  labels: GridLabels | null;
  theme: Theme;
}

const CELL = { row: 100, col: 100 };

export default function Phone({ step, labels, theme }: Props) {
  const { t } = useI18n();
  const screen = (i: number, cls: string, content: React.ReactNode) => (
    <div key={i} className={`screen layer ${cls}${step === i ? " is-active" : ""}`}>
      {content}
    </div>
  );

  return (
    <div className="phone" aria-hidden="true">
      <div className="phone-notch" />
      <div className="phone-screen">
        <div className="phone-bar">
          <span className="wm">
            <i />
            ZKanopy
          </span>
          <span>{t("phone.place")}</span>
        </div>
        {screen(
          0,
          "s-map",
          <>
            {labels && <GridCanvas data={labels} theme={theme} fit="cover" className="phone-map" />}
            <div className="pin">
              <MapPin size={30} strokeWidth={2.2} />
            </div>
            <div className="sheet">{t("phone.tap")}</div>
          </>
        )}
        {screen(
          1,
          "s-cell",
          <>
            <CellZoom labels={labels} cell={CELL} size={7} />
            <div className="badge ok">
              <Check size={14} /> {t("phone.clean")} · {CELL.row} · {CELL.col}
            </div>
            <div className="pbtn">{t("phone.generate")}</div>
          </>
        )}
        {screen(
          2,
          "s-prove",
          <>
            <div className="proving">
              <Cpu size={18} /> {t("phone.proving")}
            </div>
            <div className="pbar">
              <i />
            </div>
            <div className="ptime">{t("phone.done")}</div>
            <pre className="psig">{"nullifier  0x1748…deb8\nroot       0x09f5…ad7a\nseason     2026\nexporter   0x9584…8923"}</pre>
          </>
        )}
        {screen(
          3,
          "s-done",
          <>
            <div className="pcard">
              <ShieldCheck size={30} />
              <b>{t("phone.sent")}</b>
              <span>tx 0xeb48…06df</span>
            </div>
            <div className="ptry">
              {t("phone.second")}
              <span className="stamp small">NullifierAlreadyUsed</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
