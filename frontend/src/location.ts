// Location service: expo-location on native (with contextual permission flow),
// browser geolocation on web. Callers show a benefit explanation before calling
// ensureLocationPermission, and an "Open Settings" action when it returns "blocked".
import * as Location from "expo-location";
import { Platform } from "react-native";

import { getLocationStatus, isLocationActive, LOCATION_FRESHNESS_MS } from "./location-status";
import type { DevicePoint } from "./location-status";

export type { DeviceLocationStatus, DevicePoint } from "./location-status";
export { LOCATION_FRESHNESS_MS, getLocationStatus, isLocationActive };

export type LocationPermission = "granted" | "denied" | "blocked";

const unknownPoint = (): DevicePoint => ({
  type: "Point", coordinates: [], source: "UNKNOWN", accuracy: null, timestamp: new Date().toISOString(), is_active: false,
});

const toPoint = (longitude: number, latitude: number, accuracy: number | null, timestamp: number, source: DevicePoint["source"]): DevicePoint => {
  const point: DevicePoint = {
    type: "Point",
    coordinates: [longitude, latitude],
    source,
    accuracy,
    timestamp: new Date(timestamp).toISOString(),
    is_active: true,
  };
  point.is_active = isLocationActive(point);
  return point;
};

/** Checks first, then requests only if the OS still allows asking. */
export async function ensureLocationPermission(): Promise<LocationPermission> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return "granted";
    if (!current.canAskAgain) return "blocked";
    const requested = await Location.requestForegroundPermissionsAsync();
    return requested.granted ? "granted" : requested.canAskAgain ? "denied" : "blocked";
  } catch {
    return "granted"; // unsupported environments fall back to the browser prompt
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export async function getDeviceLocation(): Promise<DevicePoint> {
  try {
    const permission = await ensureLocationPermission();
    if (permission === "granted") {
      const position = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 6000);
      if (position) return toPoint(position.coords.longitude, position.coords.latitude, position.coords.accuracy ?? null, position.timestamp, "CURRENT_GPS");
      const last = await Location.getLastKnownPositionAsync();
      if (last) return toPoint(last.coords.longitude, last.coords.latitude, last.coords.accuracy ?? null, last.timestamp, "LAST_KNOWN");
    }
  } catch { /* fall through to the browser API below */ }
  if (typeof navigator !== "undefined" && navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(toPoint(position.coords.longitude, position.coords.latitude, position.coords.accuracy, position.timestamp, "CURRENT_GPS")),
        () => resolve(unknownPoint()),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 },
      );
    });
  }
  return unknownPoint();
}

/** Streams device positions; caller must have resolved permission first. Returns an unsubscribe function. */
export async function watchDeviceLocation(onPoint: (point: DevicePoint) => void): Promise<() => void> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
    const watchId = navigator.geolocation.watchPosition(
      (position) => onPoint(toPoint(position.coords.longitude, position.coords.latitude, position.coords.accuracy, position.timestamp, "CURRENT_GPS")),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }
  const subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 8000, distanceInterval: 10 },
    (position) => onPoint(toPoint(position.coords.longitude, position.coords.latitude, position.coords.accuracy ?? null, position.timestamp, "CURRENT_GPS")),
  );
  return () => subscription.remove();
}
