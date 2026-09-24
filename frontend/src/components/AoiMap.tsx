// Leaflet map on satellite imagery. The farmer drops a pin anywhere in the world; every published
// region is outlined so coverage is visible, and the grid overlay appears once a region has loaded.
import { useEffect, useMemo } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { gridBounds, type TreeFile } from "../lib/merkle";
import type { RegionInfo } from "../lib/regions";

interface Props {
  /** The loaded region's grid, or null while no region covers the pin yet. */
  tree: TreeFile | null;
  regions: RegionInfo[];
  point: { lat: number; lon: number } | null;
  showLoss: boolean;
  onPick: (lat: number, lon: number) => void;
  /** Bounds to move to, e.g. after a search hit. */
  focus?: LatLngBoundsExpression | null;
}

/** Moves the view when a search result or a newly loaded region asks for it. */
function FlyTo({ bounds }: { bounds: LatLngBoundsExpression | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.flyToBounds(bounds, { padding: [12, 12], duration: 0.8 });
  }, [bounds, map]);
  return null;
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

export default function AoiMap({ tree, regions, point, showLoss, onPick, focus }: Props) {
  const bounds = useMemo(() => (tree ? (gridBounds(tree) as LatLngBoundsExpression) : null), [tree]);
  const overlay = useMemo(() => (showLoss && tree ? lossOverlayUrl(tree) : null), [tree, showLoss]);
  // Before any region is loaded, open on the whole published footprint so coverage is obvious.
  const initial = useMemo<LatLngBoundsExpression>(() => {
    if (bounds) return bounds;
    if (regions.length) {
      const lats = regions.flatMap((r) => [r.bounds[0][0], r.bounds[1][0]]);
      const lons = regions.flatMap((r) => [r.bounds[0][1], r.bounds[1][1]]);
      return [
        [Math.min(...lats) - 3, Math.min(...lons) - 3],
        [Math.max(...lats) + 3, Math.max(...lons) + 3],
      ];
    }
    return [
      [-30, -90],
      [30, 120],
    ];
  }, [bounds, regions]);

  return (
    <MapContainer bounds={initial} boundsOptions={{ padding: [12, 12] }} className="map" scrollWheelZoom maxZoom={18} worldCopyJump>
      <TileLayer
        attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics &amp; the GIS User Community"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={17}
      />
      {regions.map((r) => (
        <Rectangle
          key={r.slug}
          bounds={r.bounds}
          pathOptions={{ color: "#a6ef5e", weight: 1.5, fill: true, fillOpacity: 0.06, dashArray: "6 6" }}
          interactive={false}
        />
      ))}
      {overlay && bounds && <ImageOverlay url={overlay} bounds={bounds} opacity={0.85} interactive={false} className="pixelated" />}
      {point && (
        <CircleMarker center={[point.lat, point.lon]} radius={7} pathOptions={{ color: "#a6ef5e", weight: 2, fillColor: "#0a0e0c", fillOpacity: 0.9 }} />
      )}
      <ClickCatcher onPick={onPick} />
      <FlyTo bounds={focus ?? bounds} />
    </MapContainer>
  );
}
