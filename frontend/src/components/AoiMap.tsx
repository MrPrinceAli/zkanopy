// Leaflet map of the AOI: grid boundary, optional loss-cell overlay (demo aid) and click-to-select.
import { useMemo } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Rectangle, TileLayer, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { gridBounds, type TreeFile } from "../lib/merkle";

interface Props {
  tree: TreeFile;
  point: { lat: number; lon: number } | null;
  showLoss: boolean;
  onPick: (lat: number, lon: number) => void;
}

function ClickCatcher({ onPick }: { onPick: Props["onPick"] }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** One pixel per cell; loss cells painted red. Row 0 is the southern edge, canvas row 0 is the top. */
function lossOverlayUrl(tree: TreeFile): string {
  const canvas = document.createElement("canvas");
  canvas.width = tree.cols;
  canvas.height = tree.rows;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(tree.cols, tree.rows);
  for (let row = 0; row < tree.rows; row++) {
    const y = tree.rows - 1 - row;
    for (let col = 0; col < tree.cols; col++) {
      if (tree.labels[row * tree.cols + col] === "0") {
        const o = (y * tree.cols + col) * 4;
        img.data[o] = 220;
        img.data[o + 1] = 38;
        img.data[o + 2] = 38;
        img.data[o + 3] = 150;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export default function AoiMap({ tree, point, showLoss, onPick }: Props) {
  const bounds = useMemo(() => gridBounds(tree) as LatLngBoundsExpression, [tree]);
  const overlay = useMemo(() => (showLoss ? lossOverlayUrl(tree) : null), [tree, showLoss]);

  return (
    <MapContainer bounds={bounds} boundsOptions={{ padding: [12, 12] }} className="map" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Rectangle bounds={bounds} pathOptions={{ color: "#0f766e", weight: 2, fill: false }} interactive={false} />
      {overlay && <ImageOverlay url={overlay} bounds={bounds} opacity={0.75} interactive={false} className="pixelated" />}
      {point && <CircleMarker center={[point.lat, point.lon]} radius={7} pathOptions={{ color: "#1d4ed8", fillOpacity: 0.9 }} />}
      <ClickCatcher onPick={onPick} />
    </MapContainer>
  );
}
