import { useCallback, useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import WebView from "react-native-webview";

import { useTheme } from "@/src/theme";
import { computeRegion, CrisisMapProps, markerColor } from "./crisis-map-utils";

const OPENSTREETMAP_HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{width:100%;height:100%;margin:0;background:#e8e5df;overscroll-behavior:contain;touch-action:none}.leaflet-control-attribution{font-size:10px}</style>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head><body><div id="map"></div><script>
const map=L.map('map',{zoomControl:true,dragging:true,touchZoom:true,doubleClickZoom:true,scrollWheelZoom:true,keyboard:true,inertia:true,inertiaDeceleration:2000,inertiaMaxSpeed:1500,worldCopyJump:true}).setView([20,0],2);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',{maxZoom:16,attribution:'Esri, HERE, Garmin, &copy; OpenStreetMap contributors'}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',{maxZoom:16}).addTo(map);
const layer=L.layerGroup().addTo(map);
const trailLayer=L.layerGroup().addTo(map);
let fittedIds='';
window.updateCrisisMap=function(markers,trail){
  layer.clearLayers();
  trailLayer.clearLayers();
  if(trail.length>1)L.polyline(trail.map(function(point){return [point.latitude,point.longitude]}),{color:'#55c8ff',weight:4,opacity:0.9}).addTo(trailLayer);
  markers.forEach(function(marker){
    const point=L.circleMarker([marker.latitude,marker.longitude],{radius:8,color:'#ffffff',weight:2,fillColor:marker.color,fillOpacity:1}).addTo(layer);
    const label=document.createElement('span');label.textContent=marker.label;point.bindPopup(label);
  });
  const ids=markers.map(function(marker){return marker.id}).join('|');
  if(markers.length&&ids!==fittedIds){
    fittedIds=ids;
    if(markers.length===1)map.setView([markers[0].latitude,markers[0].longitude],14);
    else map.fitBounds(L.latLngBounds(markers.map(function(marker){return [marker.latitude,marker.longitude]})),{padding:[32,32],maxZoom:14});
  }
};
</script></body></html>`;

export function CrisisMap({ markers, trail = [], height = 220, testID }: CrisisMapProps) {
  const { colors } = useTheme();
  const webViewRef = useRef<WebView>(null);
  const latestMarkers = useRef(markers);
  const latestTrail = useRef(trail);

  const sendMapData = useCallback((items: CrisisMapProps["markers"], path: CrisisMapProps["trail"]) => {
    const payload = JSON.stringify(items.map((marker) => ({
      ...marker,
      color: markerColor(marker.kind, colors),
    }))).replace(/</g, "\\u003c");
    const trailPayload = JSON.stringify(path ?? []);
    webViewRef.current?.injectJavaScript(`window.updateCrisisMap && window.updateCrisisMap(${payload},${trailPayload}); true;`);
  }, [colors]);

  useEffect(() => {
    latestMarkers.current = markers;
    latestTrail.current = trail;
    sendMapData(markers, trail);
  }, [markers, trail, sendMapData]);

  if (Platform.OS === "android") {
    return (
      <View testID={testID} style={[styles.frame, { height, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
        <WebView
          ref={webViewRef}
          style={StyleSheet.absoluteFill}
          source={{ html: OPENSTREETMAP_HTML, baseUrl: "https://openstreetmap.org" }}
          originWhitelist={["*"]}
          javaScriptEnabled
          nestedScrollEnabled={false}
          onLoadEnd={() => sendMapData(latestMarkers.current, latestTrail.current)}
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.frame, { height, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={computeRegion(markers)}
        userInterfaceStyle="dark"
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {trail.length > 1 ? <Polyline coordinates={trail} strokeColor="#55c8ff" strokeWidth={4} /> : null}
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            title={marker.label}
            pinColor={markerColor(marker.kind, colors)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: 17, overflow: "hidden" },
  webview: { flex: 1, backgroundColor: "#212121" },
});


