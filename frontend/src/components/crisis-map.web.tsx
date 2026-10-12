import * as L from "leaflet";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { unstable_createElement } from "react-native-web";

import { useTheme } from "@/src/theme";
import { CrisisMapProps, markerColor } from "./crisis-map-utils";

const BASE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LABEL_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

function ensureLeafletCss() {
  if (typeof document === "undefined" || document.querySelector("link[data-crisisos-leaflet]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  link.setAttribute("data-crisisos-leaflet", "1");
  document.head.appendChild(link);
}

export function CrisisMap({ markers, trail = [], height = 220, testID }: CrisisMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const fittedKey = useRef("");
  const { colors } = useTheme();
  ensureLeafletCss();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [20, 0], zoom: 2, attributionControl: true });
    L.tileLayer(BASE_TILE_URL, {
      attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
      maxZoom: 16,
    }).addTo(map);
    L.tileLayer(LABEL_TILE_URL, { maxZoom: 16 }).addTo(map);
    trailRef.current = L.polyline([], { color: "#55c8ff", weight: 4, opacity: 0.9 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      trailRef.current = null;
    };
  }, []);

  useEffect(() => {
    trailRef.current?.setLatLngs(trail.map((point) => [point.latitude, point.longitude]));
  }, [trail]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markers.forEach((marker) => {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;border:2px solid rgba(0,0,0,0.65);background:${markerColor(marker.kind, colors)};box-shadow:0 0 8px rgba(0,0,0,0.6);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([marker.latitude, marker.longitude], { icon }).bindPopup(marker.label).addTo(layer);
    });
    const key = markers.map((marker) => marker.id).join("|");
    if (markers.length > 0 && key !== fittedKey.current) {
      fittedKey.current = key;
      if (markers.length === 1) {
        map.setView([markers[0].latitude, markers[0].longitude], 14);
      } else {
        map.fitBounds(L.latLngBounds(markers.map((marker) => [marker.latitude, marker.longitude] as [number, number])), { padding: [48, 48], maxZoom: 14 });
      }
    }
  }, [markers, colors]);

  return (
    <View testID={testID} style={[styles.frame, { height, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      {unstable_createElement("div", { ref: containerRef, style: { width: "100%", height: "100%" } })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: 17, overflow: "hidden" },
});
