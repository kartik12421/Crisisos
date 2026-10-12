import Constants from "expo-constants";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

export type Role = "CITIZEN" | "RESPONDER" | "OPERATOR" | "ADMIN" | "ORGANIZATION_ADMIN";
export type EmergencyType = "GENERAL" | "TRAPPED_PERSON" | "MEDICAL" | "FIRE" | "FLOOD" | "ACCIDENT" | "BUILDING_COLLAPSE" | "MISSING_PERSON" | "OTHER";
export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export type Session = { user_id: string; name: string; email: string; role: Role; organization_id: string; mobile_number?: string };
export type IncidentMedia = { path: string; content_type?: string };
export type Incident = {
  id: string; sos_id: string; title: string; description: string; type: EmergencyType; status: string;
  severity: string; location: { source?: string; coordinates?: number[]; accuracy?: number | null };
  affected_people: number; ai_analysis: { summary: string; required_capabilities: string[]; confidence: number; risks: string[]; human_approval_required: boolean; provider?: string };
  media?: IncidentMedia[]; assigned_responder_id?: string | null; created_at: string; updated_at: string;
  reported_by_mobile?: string;
};
export type Responder = { id: string; name: string; team: string; skills: string[]; status: string; distance_km: number; current_location?: Record<string, unknown> | null };
export type Assignment = { id: string; incident_id: string; responder_id: string; responder_name: string; status: string; approved_by: string; assigned_at: string; updated_at: string; note: string };
export type Analytics = {
  total_emergencies: number; active_incidents: number; critical_incidents: number; human_approvals: number;
  by_type?: Record<string, number>; by_severity?: Record<string, number>;
  avg_resolution_minutes?: number | null; active_alerts?: number; responders_available?: number;
};
export type CrisisAlert = { id: string; title: string; message: string; severity: AlertSeverity; radius_km?: number | null; created_by: string; created_at: string; active: boolean };
export type OperatorLocationHistoryEntry = { location: Record<string, unknown>; timestamp: string; updated_at: string };
export type OperatorLocationHistory = { operator_id: string; current_location?: Record<string, unknown> | null; total_past_locations: number; location_history: OperatorLocationHistoryEntry[] };
export type SosPayload = { emergency_type: EmergencyType; description: string; affected_people: number; idempotency_key: string; location: Record<string, unknown>; media_paths?: string[] };
export type CrisisEvent = { type: string; payload: Record<string, unknown>; at: string };
export type PickedImage = { uri: string; fileName?: string | null; mimeType?: string | null };

export type OperatorAssignmentStatus = "ASSIGNED" | "EN_ROUTE" | "ON_SCENE" | "COMPLETED" | "CANCELLED";
export type OperatorAssignment = {
  id: string;
  operator_id: string;
  operator_name: string;
  incident_id: string;
  citizen_id: string;
  citizen_name: string;
  status: OperatorAssignmentStatus;
  assigned_at: string;
  updated_at: string;
  note: string;
  incident?: Incident;
};
export type NearestIncident = {
  id: string;
  sos_id: string;
  title: string;
  description: string;
  type: EmergencyType;
  status: string;
  severity: string;
  location: { source?: string; coordinates?: number[]; accuracy?: number | null };
  affected_people: number;
  ai_analysis: { summary: string; required_capabilities: string[]; confidence: number; risks: string[]; human_approval_required: boolean; provider?: string };
  media?: IncidentMedia[];
  reported_by: string | null;
  reported_by_name: string | null;
  reported_by_mobile?: string;
  created_at: string;
  distance_km: number;
};

type TokenResponse = { access_token: string; token_type: string; user: { id: string; name: string; email: string; role: Role; organization_id: string; mobile_number?: string } };

function getMetroHostIp(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants.manifest2?.extra?.expoGo as { debuggerHost?: string } | undefined)?.debuggerHost ||
    (Constants as unknown as { manifest?: { debuggerHost?: string } })?.manifest?.debuggerHost;
  if (hostUri) {
    const ip = hostUri.split(":")[0];
    if (ip && ip !== "localhost" && ip !== "127.0.0.1") {
      return ip;
    }
  }
  return null;
}

function resolveBaseUrl(): string {
  const configured =
    Constants.expoConfig?.extra?.backendUrl ||
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    process.env.EXPO_BACKEND_URL;

  if (Platform.OS === "web") {
    return String(configured || "http://127.0.0.1:8000").replace(/\/$/, "");
  }

  if (configured && !/127\.0\.0\.1|localhost/.test(configured)) {
    return String(configured).replace(/\/$/, "");
  }

  const metroIp = getMetroHostIp();
  if (metroIp) {
    return `http://${metroIp}:8000`;
  }

  if (Platform.OS === "android") {
    return "http://10.0.2.2:8000";
  }

  return String(configured || "http://127.0.0.1:8000").replace(/\/$/, "");
}

const baseUrl = resolveBaseUrl();

const TOKEN_KEY = "crisisos.auth.token";
const SESSION_KEY = "crisisos.auth.session";

let authToken: string | null = null;
let onAuthRequired: (() => void) | null = null;

export function setAuthErrorHandler(handler: () => void) { onAuthRequired = handler; }

export async function clearAuth(): Promise<void> {
  authToken = null;
  await storage.removeItem(SESSION_KEY);
  await storage.secureRemove(TOKEN_KEY);
}

let cachedSession: Session | null = null;

export function getCachedSession(): Session | null {
  return cachedSession;
}

function toSession(res: TokenResponse): Session {
  return { user_id: res.user.id, name: res.user.name, email: res.user.email, role: res.user.role, organization_id: res.user.organization_id, mobile_number: res.user.mobile_number };
}

async function persistAuth(res: TokenResponse): Promise<Session> {
  authToken = res.access_token;
  const session = toSession(res);
  cachedSession = session;
  await storage.secureSet(TOKEN_KEY, res.access_token);
  await storage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function restoreSession(): Promise<Session | null> {
  const [saved, token] = await Promise.all([storage.getItem<string | null>(SESSION_KEY, null), storage.secureGet<string | null>(TOKEN_KEY, null)]);
  if (!saved || !token) {
    cachedSession = null;
    return null;
  }
  authToken = token;
  try {
    await crisisApi.me();
    const parsed = JSON.parse(saved) as Session;
    cachedSession = parsed;
    return parsed;
  } catch {
    await clearAuth();
    cachedSession = null;
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...((init?.headers ?? {}) as Record<string, string>) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(`${baseUrl}/api${path}`, { ...init, headers });
  if (response.status === 401 && authToken) {
    await clearAuth();
    onAuthRequired?.();
    throw new Error("Your session expired. Please sign in again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = (body as { detail?: unknown }).detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => (item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : String(item))).join(", ")
        : "Something went wrong. Please try again.";
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export function rawMediaUrl(path: string): string {
  return `${baseUrl}/api/files/${path}`;
}

export async function signMediaUrl(path: string): Promise<string> {
  const result = await request<{ url: string }>(`/media/sign?path=${encodeURIComponent(path)}`);
  return `${baseUrl}${result.url}`;
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network|failed to fetch|load failed/i.test(error.message));
}

export function subscribeEvents(onEvent: (event: CrisisEvent) => void, onState?: (connected: boolean) => void): () => void {
  if (!baseUrl) return () => undefined;
  let closed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
    heartbeat = null;
    heartbeatTimeout = null;
  };

  const connect = () => {
    if (closed) return;
    try {
      socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/ws${authToken ? `?token=${encodeURIComponent(authToken)}` : ""}`);
      socket.onopen = () => {
        attempt = 0; onState?.(true);
        clearHeartbeat();
        heartbeat = setInterval(() => {
          if (socket?.readyState !== WebSocket.OPEN) return;
          try { socket.send("ping"); } catch { socket?.close(); return; }
          heartbeatTimeout = setTimeout(() => socket?.close(), 5000);
        }, 15000);
      };
      socket.onmessage = (message) => {
        if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
        try {
          const event = JSON.parse(String(message.data)) as CrisisEvent;
          if (event.type !== "pong") onEvent(event);
        } catch {}
      };
      socket.onclose = () => {
        onState?.(false);
        clearHeartbeat();
        if (closed) return;
        timer = setTimeout(connect, Math.min(10000, 1500 * 2 ** attempt++));
      };
      socket.onerror = () => { socket?.close(); };
    } catch {
      timer = setTimeout(connect, 5000);
    }
  };

  const canListen = typeof window !== "undefined" && typeof window.addEventListener === "function";
  const handleOffline = () => { onState?.(false); socket?.close(); };
  const handleOnline = () => { if (!closed && (!socket || socket.readyState === WebSocket.CLOSED)) { attempt = 0; connect(); } };
  if (canListen) {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
  }
  connect();

  return () => {
    closed = true;
    clearHeartbeat();
    if (timer) clearTimeout(timer);
    if (canListen) {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    }
    socket?.close();
  };
}

export const crisisApi = {
  login: (email: string, password: string) => request<TokenResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }).then(persistAuth),
  signup: (name: string, email: string, mobile: string, password: string) => request<TokenResponse>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, mobile_number: mobile, password }) }).then(persistAuth),
  me: () => request<{ id: string; email: string; role: Role }>("/auth/me"),
  logout: () => clearAuth(),
  incidents: () => request<Incident[]>("/incidents"),
  responders: () => request<Responder[]>("/responders"),
  assignments: () => request<Assignment[]>("/assignments"),
  analytics: () => request<Analytics>("/analytics"),
  audit: () => request<{ id: string; action: string; actor: string; detail: string; created_at: string }[]>("/audit"),
  alerts: () => request<CrisisAlert[]>("/alerts"),
  publishAlert: (payload: { title: string; message: string; severity: AlertSeverity; radius_km: number | null }) => request<CrisisAlert>("/alerts", { method: "POST", body: JSON.stringify(payload) }),
  deactivateAlert: (alertId: string) => request<CrisisAlert>(`/alerts/${alertId}/deactivate`, { method: "POST" }),
  createSos: (payload: SosPayload) => request<Incident>("/sos", { method: "POST", body: JSON.stringify(payload) }),
  approveDispatch: (incidentId: string, responderId: string) => request<Assignment>(`/incidents/${incidentId}/approve-dispatch`, { method: "POST", body: JSON.stringify({ responder_id: responderId }) }),
  updateAssignment: (assignmentId: string, status: string, note = "") => request<Assignment>(`/assignments/${assignmentId}/status`, { method: "PATCH", body: JSON.stringify({ status, note }) }),
  updateResponderLocation: (responderId: string, location: Record<string, unknown>) => request<Responder>(`/responders/${responderId}/location`, { method: "PATCH", body: JSON.stringify({ location }) }),

  getNearestIncidents: (lon: number, lat: number, maxDistanceKm = 50, limit = 5) =>
    request<NearestIncident[]>(`/operator/incidents/nearest?lon=${lon}&lat=${lat}&max_distance_km=${maxDistanceKm}&limit=${limit}`),
  createOperatorAssignment: (incidentId: string) =>
    request<OperatorAssignment>("/operator/assignments", { method: "POST", body: JSON.stringify({ incident_id: incidentId }) }),
  getActiveOperatorAssignment: () =>
    request<OperatorAssignment | null>("/operator/assignments/active"),
  updateOperatorLocation: (location: Record<string, unknown>) =>
    request<{ status: string }>("/operator/location", { method: "PATCH", body: JSON.stringify({ location }) }),
  getOperatorLocationHistory: () => request<OperatorLocationHistory>("/operator/location-history"),
  updateOperatorAssignmentStatus: (assignmentId: string, status: OperatorAssignmentStatus, note = "") =>
    request<OperatorAssignment>(`/operator/assignments/${assignmentId}/status`, { method: "PATCH", body: JSON.stringify({ status, note }) }),
  locateCitizen: (assignmentId: string) =>
    request<{ success: boolean; message: string }>(`/operator/assignments/${assignmentId}/locate-citizen`, { method: "POST" }),

  uploadMedia: async (asset: PickedImage): Promise<{ id: string; path: string; content_type: string }> => {
    const form = new FormData();
    const name = asset.fileName ?? `photo-${Date.now()}.jpg`;
    if (Platform.OS === "web") {
      const blob = await (await fetch(asset.uri)).blob();
      form.append("file", blob, name);
    } else {
      form.append("file", { uri: asset.uri, name, type: asset.mimeType ?? "image/jpeg" } as unknown as Blob);
    }
    const response = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail ?? "Photo upload failed. You can still send the SOS.");
    }
    return response.json() as Promise<{ id: string; path: string; content_type: string }>;
  },
};

const OUTBOX_KEY = "crisisos.sos.outbox.v1";

export async function getOutbox(): Promise<SosPayload[]> {
  const raw = await storage.getItem<string | null>(OUTBOX_KEY, null);
  if (!raw) return [];
  try { return JSON.parse(raw) as SosPayload[]; } catch { return []; }
}

export async function enqueueSos(payload: SosPayload): Promise<number> {
  const queue = await getOutbox();
  queue.push(payload);
  await storage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  return queue.length;
}

export async function flushOutbox(): Promise<{ sent: Incident[]; remaining: number }> {
  const queue = await getOutbox();
  const sent: Incident[] = [];
  let index = 0;
  for (; index < queue.length; index += 1) {
    try {
      sent.push(await crisisApi.createSos(queue[index]));
    } catch (error) {
      if (isNetworkError(error)) break;
    }
  }
  const remaining = queue.slice(index);
  await storage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  return { sent, remaining: remaining.length };
}
