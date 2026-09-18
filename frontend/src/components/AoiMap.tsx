// Leaflet map of the AOI on satellite imagery: grid boundary, optional loss-cell overlay and click-to-select.
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

/** One pixel per cell; flagged cells painted ember. Row 0 is the southern edge, canvas row 0 is the top. */
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
        img.data[o] = 240;
        img.data[o + 1] = 162;
        img.data[o + 2] = 91;
        img.data[o + 3] = 170;
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
    <MapContainer bounds={bounds} boundsOptions={{ padding: [12, 12] }} className="map" scrollWheelZoom maxZoom={18}>
      <TileLayer
        attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics &amp; the GIS User Community"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={17}
      />
      <Rectangle bounds={bounds} pathOptions={{ color: "#a6ef5e", weight: 1.5, fill: false, dashArray: "6 6" }} interactive={false} />
      {overlay && <ImageOverlay url={overlay} bounds={bounds} opacity={0.85} interactive={false} className="pixelated" />}
      {point && (
        <CircleMarker center={[point.lat, point.lon]} radius={7} pathOptions={{ color: "#a6ef5e", weight: 2, fillColor: "#0a0e0c", fillOpacity: 0.9 }} />
      )}
      <ClickCatcher onPick={onPick} />
    </MapContainer>
  );
}
