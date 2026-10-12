export type DevicePoint = {
  type: "Point";
  coordinates: number[];
  source: "CURRENT_GPS" | "LAST_KNOWN" | "UNKNOWN";
  accuracy: number | null;
  timestamp: string;
  is_active?: boolean;
};

export type DeviceLocationStatus = {
  isActive: boolean;
  source: DevicePoint["source"];
  lastUpdatedAt: string | null;
  staleMs: number | null;
};

export const LOCATION_FRESHNESS_MS = 60_000;

const parsePointTimestamp = (timestamp: string | number | undefined): number | null => {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

export function isLocationActive(point: DevicePoint | null | undefined, maxAgeMs = LOCATION_FRESHNESS_MS): boolean {
  if (!point || !Array.isArray(point.coordinates) || point.coordinates.length !== 2) return false;
  if (point.source === "UNKNOWN") return false;

  const timeMs = parsePointTimestamp(point.timestamp);
  if (timeMs === null) return false;

  return Date.now() - timeMs <= maxAgeMs;
}

export function getLocationStatus(point: DevicePoint | null | undefined, maxAgeMs = LOCATION_FRESHNESS_MS): DeviceLocationStatus {
  const source = point?.source ?? "UNKNOWN";
  const lastUpdatedAt = point?.timestamp ?? null;
  const staleMs = lastUpdatedAt ? Date.now() - (parsePointTimestamp(lastUpdatedAt) ?? Date.now()) : null;

  return {
    isActive: point !== null && point !== undefined && isLocationActive(point, maxAgeMs),
    source,
    lastUpdatedAt,
    staleMs,
  };
}
