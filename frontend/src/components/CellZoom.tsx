// Nine-by-nine neighbourhood of a cell, rendered from the real labels (centre cell highlighted).
import type { GridLabels } from "./GridCanvas";

export default function CellZoom({ labels, cell, size = 9 }: { labels: GridLabels | null; cell: { row: number; col: number }; size?: number }) {
  const half = Math.floor(size / 2);
  const cells: Array<{ key: string; cls: string }> = [];
  for (let dr = half; dr >= -half; dr--) {
    for (let dc = -half; dc <= half; dc++) {
      const r = cell.row + dr;
      const c = cell.col + dc;
      const inside = labels && r >= 0 && r < labels.rows && c >= 0 && c < labels.cols;
      const loss = inside ? labels!.labels[r * labels!.cols + c] === "0" : false;
      cells.push({ key: `${r}:${c}`, cls: dr === 0 && dc === 0 ? "me" : loss ? "loss" : "" });
    }
  }
  return (
    <div className="cellgrid" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }} aria-hidden="true">
      {cells.map((c) => (
        <span key={c.key} className={c.cls} />
      ))}
    </div>
  );
}
