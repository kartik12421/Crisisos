import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Linking, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Analytics, Assignment, CrisisAlert, crisisApi, flushOutbox, Incident,
  OperatorLocationHistoryEntry, Responder, restoreSession, Session, setAuthErrorHandler, subscribeEvents,
  NearestIncident, OperatorAssignment, OperatorAssignmentStatus,
} from "@/src/crisis-api";
import { AlertComposer } from "@/src/components/alert-composer";
import { AlertsStrip } from "@/src/components/alerts-strip";
import { AnalyticsPanel } from "@/src/components/analytics-panel";
import { AuthScreen } from "@/src/components/auth-screen";
import { CrisisMap } from "@/src/components/crisis-map";
import { CrisisMapMarker, CrisisMapPoint } from "@/src/components/crisis-map-utils";
import { SosComposer } from "@/src/components/sos-composer";
import { Badge, EmptyState, formatTime, MediaThumbs, Notice } from "@/src/components/ui";
import { DeviceLocationStatus, DevicePoint, ensureLocationPermission, getLocationStatus, watchDeviceLocation } from "@/src/location";
import { makeStyles, useTheme } from "@/src/theme";

function useCrisisSync(enabled: boolean) {
  const [connected, setConnected] = useState(false);
  const [signal, setSignal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => { timerRef.current = null; setSignal((value) => value + 1); }, 400);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeEvents(bump, setConnected);
    const fallback = setInterval(bump, 30000);
    return () => { unsubscribe(); clearInterval(fallback); };
  }, [enabled, bump]);
  return { connected, signal };
}

export default function Index() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const { connected, signal } = useCrisisSync(session !== null);

  useEffect(() => {
    setAuthErrorHandler(() => setSession(null));
    void restoreSession().then((restored) => { if (restored) setSession(restored); setBooted(true); });
  }, []);

  const signIn = async (email: string, password: string) => { setSession(await crisisApi.login(email, password)); };
  const signUp = async (name: string, email: string, mobile: string, password: string) => { setSession(await crisisApi.signup(name, email, mobile, password)); };
  const logout = async () => { await crisisApi.logout(); setSession(null); };

  if (!booted) {
    return <View style={[styles.root, styles.bootCenter, { paddingTop: insets.top }]}><ActivityIndicator color={colors.brandSecondary} size="large" /><Text style={styles.bootText}>CONNECTING TO CRISISOS…</Text></View>;
  }
  if (!session) return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;
  const role = session.role;
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Header session={session} connected={connected} onLogout={logout} />
      {role === "CITIZEN" ? <CitizenView signal={signal} /> : role === "RESPONDER" ? <ResponderView signal={signal} /> : <CommandView signal={signal} />}
    </View>
  );
}

function Header({ session, connected, onLogout }: { session: Session; connected: boolean; onLogout: () => void }) {
  const styles = useStyles(); const { colors } = useTheme();
  return <View style={styles.header}><View style={styles.flex}><Text style={styles.brand}>CRISISOS</Text><Text style={styles.headerMeta}>{session.role === "CITIZEN" ? "CITIZEN SAFETY" : session.role === "RESPONDER" ? "FIELD OPERATIONS" : "COMMAND CENTER"} · {session.name.toUpperCase()}</Text></View><View style={styles.headerRight}><View testID="connection-pill" style={[styles.online, !connected && styles.onlineWarn]}><View style={[styles.onlineDot, !connected && { backgroundColor: colors.warning }]} /><Text style={[styles.onlineText, !connected && { color: colors.warning }]}>{connected ? "LIVE" : "RECONNECTING"}</Text></View><Pressable testID="logout-button" onPress={onLogout} accessibilityRole="button" hitSlop={8}><Ionicons name="log-out-outline" size={22} color={colors.muted} /></Pressable></View></View>;
}

function CitizenView({ signal }: { signal: number }) {
  const styles = useStyles(); const { colors } = useTheme();
  const [incidents, setIncidents] = useState<Incident[]>([]); const [alerts, setAlerts] = useState<CrisisAlert[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [composer, setComposer] = useState(false); const [queued, setQueued] = useState(0);
  const [locateAlert, setLocateAlert] = useState<{ visible: boolean; operatorName: string }>({ visible: false, operatorName: "" });
  const [operatorAssigned, setOperatorAssigned] = useState<{ incidentId: string; operatorName: string; status: string } | null>(null);

  const refresh = useCallback(async () => { try { setError(""); const [i, a] = await Promise.all([crisisApi.incidents(), crisisApi.alerts()]); setIncidents(i); setAlerts(a); } catch (e) { setError(e instanceof Error ? e.message : "Unable to connect to CrisisOS."); } finally { setLoading(false); } }, []);
  useEffect(() => { refresh(); }, [signal, refresh]);

  useEffect(() => {
    let cancelled = false;
    const flush = async () => { const result = await flushOutbox(); if (cancelled) return; setQueued(result.remaining); if (result.sent.length > 0) refresh(); };
    void flush();
    const timer = setInterval(() => { void flush(); }, 15000);
    const canListen = typeof window !== "undefined" && typeof window.addEventListener === "function";
    const onOnline = () => { void flush(); };
    if (canListen) window.addEventListener("online", onOnline);
    return () => { cancelled = true; clearInterval(timer); if (canListen) window.removeEventListener("online", onOnline); };
  }, [refresh]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    (async () => {
      const { subscribeEvents } = await import("@/src/crisis-api");
      unsubscribe = subscribeEvents((event) => {
        if (event.type === "operator.locate_citizen") {
          const payload = event.payload as { operator_name?: string; citizen_id?: string };
          setLocateAlert({ visible: true, operatorName: payload.operator_name ?? "Operator" });
          playLocateSound();
          setTimeout(() => setLocateAlert({ visible: false, operatorName: "" }), 10000);
        } else if (event.type === "operator.assigned") {
          const payload = event.payload as { incident_id: string; operator_id: string; operator_name?: string };
          setOperatorAssigned({ incidentId: payload.incident_id, operatorName: payload.operator_name ?? "Operator", status: "ASSIGNED" });
          playLocateSound();
        } else if (event.type === "operator.assignment.updated") {
          const payload = event.payload as { incident_id: string; status: string };
          setOperatorAssigned((prev) => prev?.incidentId === payload.incident_id ? { ...prev, status: payload.status } : prev);
          if (payload.status === "EN_ROUTE" || payload.status === "ON_SCENE") {
            playLocateSound();
          }
        }
      });
    })();
    return () => { unsubscribe?.(); };
  }, []);

  const hasActiveIncident = incidents.some((item) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(item.status));
  const activeIncident = incidents.find((item) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(item.status));
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.sectionHeader}><View style={styles.flex}><Text style={styles.eyebrow}>PERSONAL SAFETY</Text><Text style={styles.screenTitle}>Ready when you need us.</Text></View><View style={styles.locationBadge}><Ionicons name="location-outline" size={15} color={colors.success} /><Text style={styles.locationText}>LOCATION READY</Text></View></View>
    {error ? <Notice text={error} tone="error" onPress={refresh} /> : null}
    <AlertsStrip alerts={alerts} />
    {queued > 0 ? <View testID="sos-outbox-banner"><Notice text={`${queued} SOS ${queued === 1 ? "is" : "are"} queued offline � auto-send when connection returns.`} tone="info" /></View> : null}
    {hasActiveIncident && activeIncident ? <StatusCard incident={activeIncident} /> : null}
    <View style={styles.sosPanel}><Text style={styles.sosEyebrow}>EMERGENCY SIGNAL</Text><Text style={styles.sosTitle}>Need immediate help?</Text><Text style={styles.sosBody}>Your location and emergency details will be shared with the Command Center after confirmation.</Text><Pressable testID="send-sos" accessibilityRole="button" onPress={() => setComposer(true)} style={({ pressed }) => [styles.sosButton, pressed && styles.sosPressed]}><Ionicons name="alert-circle" size={32} color={colors.onBrandPrimary} /><Text style={styles.sosButtonText}>SEND SOS</Text></Pressable><Text style={styles.sosHint}>Only press for a real emergency</Text></View>
    {operatorAssigned && (
      <View style={styles.operatorAssignedCard}>
        <View style={styles.operatorAssignedHeader}>
          <Ionicons name="shield-checkmark" size={24} color={colors.success} />
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>OPERATOR ASSIGNED</Text>
            <Text style={styles.operatorAssignedTitle}>Help is on the way</Text>
          </View>
        </View>
        <Text style={styles.operatorAssignedMeta}>Operator: {operatorAssigned.operatorName} � Status: {operatorAssigned.status.replace("_", " ")}</Text>
        {operatorAssigned.status === "EN_ROUTE" && <Text style={styles.operatorAssignedNote}>Operator is en route to your location</Text>}
        {operatorAssigned.status === "ON_SCENE" && <Text style={styles.operatorAssignedNote}>Operator has arrived at the scene</Text>}
        {operatorAssigned.status === "COMPLETED" && <Text style={styles.operatorAssignedNote}>Emergency resolved</Text>}
      </View>
    )}
    <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>RECENT INCIDENTS</Text>{loading ? <ActivityIndicator color={colors.brandSecondary} /> : null}</View>
    {incidents.length === 0 && !loading ? <EmptyState icon="shield-checkmark-outline" text="No active emergency history." /> : incidents.slice(0, 3).map((incident) => <IncidentRow key={incident.id} incident={incident} />)}
    <View style={styles.infoStrip}><Ionicons name="information-circle-outline" size={19} color={colors.info} /><Text style={styles.infoText}>Location sharing is used only when you send an SOS. You stay in control.</Text></View>
    <SosComposer visible={composer} onClose={() => setComposer(false)} onCreated={(incident) => { setIncidents((current) => [incident, ...current]); setComposer(false); }} onQueued={(count) => { setQueued(count); setComposer(false); }} />
    {locateAlert.visible && (
      <View style={styles.locateAlert}>
        <Ionicons name="volume-high" size={32} color={colors.error} />
        <View style={styles.locateAlertText}>
          <Text style={styles.locateAlertTitle}>OPERATOR TRYING TO LOCATE YOU</Text>
          <Text style={styles.locateAlertSubtitle}>{locateAlert.operatorName} triggered a locate signal</Text>
        </View>
        <Pressable onPress={() => setLocateAlert({ visible: false, operatorName: "" })} style={styles.locateAlertDismiss}>
          <Text style={styles.locateAlertDismissText}>DISMISS</Text>
        </Pressable>
      </View>
    )}
  </ScrollView>;
}

function playLocateSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(800, ctx.currentTime);
    oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.15);
    oscillator.frequency.setValueAtTime(800, ctx.currentTime + 0.3);
    oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.45);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 1.5);
  } catch {}
}

function StatusCard({ incident }: { incident: Incident }) { const styles = useStyles(); const { colors } = useTheme(); const steps = ["ACKNOWLEDGED", "ACTIVE_RESPONSE", "ON_SCENE", "RESOLVED"]; const current = incident.status === "ASSIGNED" ? 1 : steps.indexOf(incident.status); return <View style={styles.statusCard}><View style={styles.statusTop}><View style={styles.statusHeading}><Text style={styles.eyebrow}>ACTIVE EMERGENCY</Text><Text style={styles.statusTitle}>{incident.title}</Text></View><Badge text={incident.status.replace("_", " ")} tone={incident.status === "RESOLVED" ? "success" : "warning"} /></View><Text style={styles.statusSummary}>{incident.ai_analysis.summary}</Text>{incident.media && incident.media.length > 0 ? <View style={styles.mediaSpacing}><MediaThumbs media={incident.media} /></View> : null}<View style={styles.timeline}>{steps.map((step, index) => <View key={step} style={styles.timelineItem}><View style={[styles.timelineDot, index <= current && styles.timelineDotActive]}>{index <= current ? <Ionicons name="checkmark" size={11} color={colors.onBrandPrimary} /> : null}</View><Text style={[styles.timelineText, index <= current && styles.timelineTextActive]}>{step.replace("_", " ")}</Text>{index < steps.length - 1 ? <View style={[styles.timelineLine, index < current && styles.timelineLineActive]} /> : null}</View>)}</View></View>; }

function CommandView({ signal }: { signal: number }) {
  const styles = useStyles(); const { colors } = useTheme();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [alerts, setAlerts] = useState<CrisisAlert[]>([]);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alertComposer, setAlertComposer] = useState(false);
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(true);

  const [nearestIncidents, setNearestIncidents] = useState<NearestIncident[]>([]);
  const [operatorAssignment, setOperatorAssignment] = useState<OperatorAssignment | null>(null);
  const [operatorLocation, setOperatorLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [operatorTrail, setOperatorTrail] = useState<CrisisMapPoint[]>([]);
  const [locationStatus, setLocationStatus] = useState<DeviceLocationStatus | null>(null);
  const [locationBlocked, setLocationBlocked] = useState(false);
  const [loadingNearest, setLoadingNearest] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [i, r, a, k, al] = await Promise.all([
        crisisApi.incidents(),
        crisisApi.responders(),
        crisisApi.assignments(),
        crisisApi.analytics(),
        crisisApi.alerts(),
      ]);
      setIncidents(i);
      setResponders(r);
      setAssignments(a);
      setAnalytics(k);
      setAlerts(al);
      setSelected((current) => i.find((item) => item.id === current?.id) ?? i[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load command queue.");
    }
  }, []);

  useEffect(() => {
    crisisApi.getActiveOperatorAssignment().then(setOperatorAssignment).catch(() => {});
  }, []);

  const refreshOperatorTrail = useCallback(async () => {
    try {
      const history = await crisisApi.getOperatorLocationHistory();
      setOperatorTrail(locationHistoryTrail(history.location_history));
    } catch {
      setOperatorTrail([]);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = setTimeout(() => { void refreshOperatorTrail(); }, 0);
    const timer = setInterval(() => { void refreshOperatorTrail(); }, 30000);
    return () => { clearTimeout(initialRefresh); clearInterval(timer); };
  }, [refreshOperatorTrail]);

  const fetchNearest = useCallback(async () => {
    if (!operatorLocation) return;
    setLoadingNearest(true);
    try {
      const nearest = await crisisApi.getNearestIncidents(operatorLocation.longitude, operatorLocation.latitude, 50, 5);
      setNearestIncidents(nearest);
    } catch (e) {
      console.warn("Failed to fetch nearest incidents:", e);
    } finally {
      setLoadingNearest(false);
    }
  }, [operatorLocation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const permission = await ensureLocationPermission();
      if (cancelled) return;
      if (permission === "blocked") { setLocationBlocked(true); return; }
      setLocationBlocked(false);
      const stopWatching = await watchDeviceLocation((point: DevicePoint) => {
        const coords = point.coordinates as number[];
        const loc = { latitude: coords[1], longitude: coords[0] };
        setOperatorLocation(loc);
        setLocationStatus(getLocationStatus(point));
        void crisisApi.updateOperatorLocation(point);
      });
      if (cancelled) stopWatching();
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (operatorLocation) fetchNearest();
  }, [operatorLocation, fetchNearest]);

  useEffect(() => {
    const timer = setInterval(() => { if (operatorLocation) fetchNearest(); }, 30000);
    return () => clearInterval(timer);
  }, [operatorLocation, fetchNearest]);

  const handleAssignmentStatusChange = async (status: OperatorAssignmentStatus, note = "") => {
    if (!operatorAssignment) return;
    setBusy(true);
    try {
      const updated = await crisisApi.updateOperatorAssignmentStatus(operatorAssignment.id, status, note);
      setOperatorAssignment(updated);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleLocateCitizen = async () => {
    if (!operatorAssignment) return;
    setBusy(true);
    try {
      await crisisApi.locateCitizen(operatorAssignment.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send locate signal.");
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptIncident = async (incident: NearestIncident) => {
    setBusy(true);
    try {
      const assignment = await crisisApi.createOperatorAssignment(incident.id);
      setOperatorAssignment(assignment);
      setNearestIncidents((prev) => prev.filter((i) => i.id !== incident.id));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept incident.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivateAlert = async (alertId: string) => {
    setBusy(true);
    try {
      await crisisApi.deactivateAlert(alertId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close alert.");
    } finally {
      setBusy(false);
    }
  };

  const selectedAssignment = assignments.find((item) => item.incident_id === selected?.id && !["COMPLETED", "CANCELLED"].includes(item.status));
  const opsMarkers = compactMarkers([...incidents.map(incidentMarker), ...responders.map(responderMarker)]);

  let operatorMapMarkers = opsMarkers;
  if (operatorAssignment?.incident) {
    const incidentMarker_ = incidentMarker(operatorAssignment.incident);
    const operatorMarker_ = operatorLocation ? { id: "operator", latitude: operatorLocation.latitude, longitude: operatorLocation.longitude, kind: "responder" as const, label: "You (Operator)" } : null;
    operatorMapMarkers = compactMarkers([incidentMarker_, operatorMarker_, ...opsMarkers]);
  }

  const approve = async () => {
    if (!selected || !responders[0]) return;
    setBusy(true);
    try {
      await crisisApi.approveDispatch(selected.id, responders[0].id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dispatch approval failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>OPERATIONS / LIVE QUEUE</Text>
          <Text style={styles.screenTitle}>Command Center</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable testID="announcements-toggle" onPress={() => setAnnouncementsEnabled(!announcementsEnabled)} accessibilityRole="switch" accessibilityState={{ checked: announcementsEnabled }} style={styles.iconButton}>
            <Ionicons name={announcementsEnabled ? "volume-high-outline" : "volume-mute-outline"} size={18} color={announcementsEnabled ? colors.brandSecondary : colors.muted} />
          </Pressable>
          <Pressable testID="publish-alert-button" onPress={() => setAlertComposer(true)} accessibilityRole="button" style={styles.iconButton}>
            <Ionicons name="megaphone-outline" size={18} color={colors.brandSecondary} />
          </Pressable>
          <Pressable testID="command-refresh-button" onPress={refresh} accessibilityRole="button" style={styles.iconButton}>
            <Ionicons name="refresh" size={18} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>
      </View>
      {error ? <Notice text={error} tone="error" onPress={refresh} /> : null}
      <View style={styles.kpiRow}>
        <Kpi label="ACTIVE" value={String(analytics?.active_incidents ?? 0)} tone="warning" />
        <Kpi label="CRITICAL" value={String(analytics?.critical_incidents ?? 0)} tone="error" />
        <Kpi label="APPROVED" value={String(analytics?.human_approvals ?? 0)} tone="success" />
      </View>

      <View style={styles.alertsManagementPanel}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>ACTIVE ALERTS</Text>
        </View>
        {alerts.length === 0 ? (
          <EmptyState icon="megaphone-outline" text="No active alerts. Publish one to notify citizens." />
        ) : (
          <View style={styles.alertsManagementList}>
            {alerts.map((alert) => (
              <View key={alert.id} style={styles.alertManagementCard}>
                <View style={styles.alertManagementLeft}>
                  <View style={[styles.alertSeverityDot, { backgroundColor: alert.severity === "CRITICAL" ? colors.error : alert.severity === "WARNING" ? colors.warning : colors.info }]} />
                  <View style={styles.alertManagementInfo}>
                    <Text style={styles.alertManagementTitle}>{alert.title}</Text>
                    <Text style={styles.alertManagementMeta}>{alert.severity}{alert.radius_km ? ` · ${alert.radius_km} KM RADIUS` : ""} · {new Date(alert.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                    <Text style={styles.alertManagementMessage} numberOfLines={2}>{alert.message}</Text>
                  </View>
                </View>
                {alert.active && (
                  <Pressable testID={`deactivate-alert-${alert.id}`} onPress={() => handleDeactivateAlert(alert.id)} style={styles.deactivateButton} disabled={busy}>
                    <Ionicons name="close-circle-outline" size={18} color={colors.onError} />
                    <Text style={styles.deactivateButtonText}>CLOSE</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      {operatorAssignment ? (
        <View style={styles.operatorAssignmentCard}>
          <View style={styles.assignmentHeader}>
            <View style={styles.assignmentIcon}>
              <Ionicons name="navigate" size={24} color={colors.onBrandPrimary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>ACTIVE CITIZEN ASSIGNMENT</Text>
              <Text style={styles.assignmentTitle}>{operatorAssignment.incident?.title ?? "Citizen SOS"}</Text>
              <Text style={styles.assignmentMeta}>Citizen: {operatorAssignment.citizen_name} � {operatorAssignment.status.replace("_", " ")}</Text>
            </View>
            <Badge text={operatorAssignment.incident?.severity ?? "UNKNOWN"} tone={operatorAssignment.incident?.severity === "CRITICAL" ? "error" : "warning"} />
          </View>
          {operatorAssignment.incident?.media && operatorAssignment.incident.media.length > 0 ? (
            <View style={styles.mediaSpacing}><MediaThumbs media={operatorAssignment.incident.media} /></View>
          ) : null}
          <Text style={styles.assignmentSummary}>{operatorAssignment.incident?.ai_analysis.summary ?? "No AI analysis available"}</Text>
          <View style={styles.assignmentActions}>
            {operatorAssignment.status === "ASSIGNED" && (
              <Pressable onPress={() => handleAssignmentStatusChange("EN_ROUTE", "Operator en route to citizen")} style={styles.actionButton} disabled={busy}>
                <Ionicons name="walk" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.actionButtonText}>EN ROUTE</Text>
              </Pressable>
            )}
            {operatorAssignment.status === "EN_ROUTE" && (
              <Pressable onPress={() => handleAssignmentStatusChange("ON_SCENE", "Operator arrived at scene")} style={styles.actionButton} disabled={busy}>
                <Ionicons name="location" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.actionButtonText}>ON SCENE</Text>
              </Pressable>
            )}
            {(operatorAssignment.status === "EN_ROUTE" || operatorAssignment.status === "ON_SCENE") && (
              <Pressable onPress={handleLocateCitizen} style={[styles.actionButton, styles.actionButtonSecondary]} disabled={busy}>
                <Ionicons name="volume-high" size={18} color={colors.brandSecondary} />
                <Text style={styles.actionButtonText}>LOCATE CITIZEN</Text>
              </Pressable>
            )}
            {operatorAssignment.status === "ON_SCENE" && (
              <Pressable onPress={() => handleAssignmentStatusChange("COMPLETED", "Emergency resolved")} style={[styles.actionButton, styles.actionButtonSuccess]} disabled={busy}>
                <Ionicons name="checkmark-done" size={18} color={colors.onSuccess} />
                <Text style={styles.actionButtonText}>RESOLVE</Text>
              </Pressable>
            )}
            {["ASSIGNED", "EN_ROUTE", "ON_SCENE"].includes(operatorAssignment.status) && (
              <Pressable onPress={() => handleAssignmentStatusChange("CANCELLED", "Cancelled by operator")} style={[styles.actionButton, styles.actionButtonDanger]} disabled={busy}>
                <Ionicons name="close" size={18} color={colors.onError} />
                <Text style={styles.actionButtonText}>CANCEL</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.nearestPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>NEAREST SOS ({nearestIncidents.length})</Text>
            {locationBlocked ? (
              <Notice text="Location access blocked � enable in Settings to see nearest incidents." tone="info" actionLabel="OPEN" onPress={() => Linking.openSettings()} />
            ) : !operatorLocation ? (
              <View style={styles.locationWaiting}><Ionicons name="location-outline" size={18} color={colors.muted} /><Text style={styles.waitingText}>Acquiring GPS...</Text></View>
            ) : (
              <View style={styles.locationStatusWrap}>
                <View style={[styles.locationPill, locationStatus?.isActive ? styles.locationPillActive : styles.locationPillPast]}>
                  <Ionicons name={locationStatus?.isActive ? "radio-outline" : "time-outline"} size={14} color={locationStatus?.isActive ? colors.success : colors.warning} />
                  <Text style={[styles.locationPillText, !locationStatus?.isActive && { color: colors.warning }]}>{locationStatus?.isActive ? "LIVE LOCATION" : "PAST LOCATION"}</Text>
                </View>
                <Pressable onPress={fetchNearest} accessibilityRole="button" style={styles.iconButton} disabled={loadingNearest}>
                  <Ionicons name={loadingNearest ? "refresh" : "refresh"} size={18} color={colors.brandSecondary} spin={loadingNearest} />
                </Pressable>
              </View>
            )}
          </View>
          {locationStatus && !locationStatus.isActive ? (
            <View style={styles.locationPastNotice}><Ionicons name="time-outline" size={16} color={colors.warning} /><Text style={styles.locationPastText}>Location is stale. Showing the last known position until live GPS refreshes.</Text></View>
          ) : null}
          {loadingNearest ? (
            <View style={styles.loadingRow}><ActivityIndicator color={colors.brandSecondary} /></View>
          ) : nearestIncidents.length === 0 ? (
            <EmptyState icon="radio-outline" text="No unassigned SOS incidents within 50 km." />
          ) : (
            <View style={styles.nearestList}>
              {nearestIncidents.map((incident) => (
                <Pressable key={incident.id} onPress={() => handleAcceptIncident(incident)} style={styles.nearestCard} disabled={busy}>
                  <View style={styles.nearestCardLeft}>
                    <Badge text={incident.severity} tone={incident.severity === "CRITICAL" ? "error" : "warning"} />
                    <Text style={styles.nearestDistance}>{incident.distance_km.toFixed(1)} km</Text>
                  </View>
                  <View style={styles.nearestCardCenter}>
                    <Text style={styles.nearestTitle}>{incident.title}</Text>
                    <Text style={styles.nearestMeta}>{incident.reported_by_name ?? "Unknown citizen"} � {incident.type.replace("_", " ")} � {incident.affected_people} people</Text>
                    {incident.reported_by_mobile && (
                      <Text style={styles.nearestMobile}>
                        <Ionicons name="call-outline" size={14} color={colors.brandSecondary} />
                        {" "}{incident.reported_by_mobile}
                      </Text>
                    )}
                  </View>
                  <View style={styles.nearestCardRight}>
                    <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>LIVE OPERATIONS MAP</Text>
      {operatorTrail.length > 1 ? <Text style={styles.locationTrailCaption}>PAST LOCATION TRACE · LAST {operatorTrail.length} POINTS</Text> : null}
      <CrisisMap testID="command-ops-map" markers={operatorMapMarkers} trail={operatorTrail} height={220} />

      <Text style={styles.sectionTitle}>ANALYTICS</Text>
      <AnalyticsPanel analytics={analytics} />

      <Text style={styles.sectionTitle}>INCIDENT QUEUE</Text>
      {incidents.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" text="All regional incidents resolved or under control." />
      ) : (
        incidents.map((incident) => (
          <Pressable key={incident.id} testID={`incident-card-${incident.id}`} onPress={() => setSelected(incident)} style={[styles.queueCard, selected?.id === incident.id && styles.queueCardActive]}>
            <View style={styles.queueTop}>
              <Badge text={incident.severity} tone={incident.severity === "CRITICAL" ? "error" : "warning"} />
              <Text style={styles.queueTime}>{formatTime(incident.created_at)}</Text>
            </View>
            <Text style={styles.queueTitle}>{incident.title}</Text>
            <Text style={styles.queueDescription} numberOfLines={2}>{incident.description}</Text>
            <View style={styles.queueFooter}>
              <Text style={styles.queueMeta}>{incident.affected_people} people � {incident.location.source ?? "UNKNOWN"}{incident.media?.length ? " � PHOTO" : ""}</Text>
              {incident.reported_by_mobile && <Text style={styles.queueMobile}><Ionicons name="call-outline" size={13} color={colors.brandSecondary} /> {" "}{incident.reported_by_mobile}</Text>}
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </View>
          </Pressable>
        ))
      )}

      {selected ? (
        <View style={styles.reviewPanel}>
          <View style={styles.reviewHeader}>
            <View>
              <Text style={styles.eyebrow}>HUMAN REVIEW REQUIRED</Text>
              <Text style={styles.reviewTitle}>AI response recommendation</Text>
            </View>
            <Badge text={`${Math.round(selected.ai_analysis.confidence * 100)}% CONF.`} tone="info" />
          </View>
          {selected.reported_by_mobile && (
            <View style={styles.reviewMobileRow}>
              <Ionicons name="call-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.reviewMobileText}>Citizen: {selected.reported_by_mobile}</Text>
            </View>
          )}
          <Text style={styles.reviewSummary}>{selected.ai_analysis.summary}</Text>
          {selected.media && selected.media.length > 0 ? <MediaThumbs media={selected.media} /> : null}
          {selected.ai_analysis.provider ? <Text style={styles.providerMeta}>ANALYSIS: {selected.ai_analysis.provider.toUpperCase()}</Text> : null}
          <View style={styles.capabilityRow}>
            {selected.ai_analysis.required_capabilities.map((capability) => (
              <View key={capability} style={styles.capability}>
                <Text style={styles.capabilityText}>{capability.replace("_", " ")}</Text>
              </View>
            ))}
          </View>
          {selectedAssignment ? (
            <View style={styles.assignmentNotice}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <View style={styles.flex}>
                <Text style={styles.assignmentTitle}>Dispatch approved</Text>
                <Text style={styles.assignmentDetail}>{selectedAssignment.responder_name} � {selectedAssignment.status.replace("_", " ")}</Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.inputLabel}>DETERMINISTIC MATCHING / AVAILABLE RESPONDERS</Text>
              {responders.slice(0, 3).map((responder, index) => (
                <View key={responder.id} style={styles.responderRow}>
                  <View style={styles.responderIcon}>
                    <Ionicons name="shield-outline" size={18} color={colors.brandSecondary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.responderName}>{responder.name}</Text>
                    <Text style={styles.responderDetail}>{responder.team} � {responder.distance_km} km</Text>
                  </View>
                  <Text style={styles.matchScore}>{[94, 87, 74][index]}%</Text>
                </View>
              ))}
              <Pressable testID="approve-dispatch-button" onPress={approve} disabled={busy} style={({ pressed }) => [styles.approveButton, pressed && styles.pressed, busy && styles.disabled]}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={20} color={colors.onBrandPrimary} />
                    <Text style={styles.approveText}>APPROVE DISPATCH</Text>
                  </>
                )}
              </Pressable>
              <Text style={styles.approvalNote}>AI cannot dispatch. This action is recorded in the audit log.</Text>
            </>
          )}
        </View>
      ) : null}
      <AlertComposer visible={alertComposer} onClose={() => setAlertComposer(false)} onPublished={() => { setAlertComposer(false); void refresh(); }} />
    </ScrollView>
  );
}
function ResponderView({ signal }: { signal: number }) {
  const styles = useStyles(); const { colors } = useTheme(); const [assignments, setAssignments] = useState<Assignment[]>([]); const [incidents, setIncidents] = useState<Incident[]>([]); const [alerts, setAlerts] = useState<CrisisAlert[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [selfPoint, setSelfPoint] = useState<DevicePoint | null>(null); const [locationBlocked, setLocationBlocked] = useState(false);
  const refresh = useCallback(async () => { try { setError(""); const [a, i, al] = await Promise.all([crisisApi.assignments(), crisisApi.incidents(), crisisApi.alerts()]); setAssignments(a); setIncidents(i); setAlerts(al); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load assignments."); } }, []);
  useEffect(() => { refresh(); }, [signal, refresh]);
  const assignment = assignments.find((item) => !["COMPLETED", "CANCELLED"].includes(item.status)); const incident = incidents.find((item) => item.id === assignment?.incident_id); const next = assignment ? ({ ASSIGNED: "ACCEPTED", ACCEPTED: "EN_ROUTE", EN_ROUTE: "ON_SCENE", ON_SCENE: "COMPLETED" } as Record<string, string>)[assignment.status] : null;
  useEffect(() => {
    if (!assignment || !["EN_ROUTE", "ON_SCENE"].includes(assignment.status)) return;
    const responderId = assignment.responder_id;
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const permission = await ensureLocationPermission();
      if (cancelled) return;
      if (permission === "blocked") { setLocationBlocked(true); return; }
      setLocationBlocked(false);
      const stopWatching = await watchDeviceLocation((point) => { setSelfPoint(point); void crisisApi.updateResponderLocation(responderId, point); });
      if (cancelled) stopWatching(); else stop = stopWatching;
    })();
    return () => { cancelled = true; stop?.(); };
  }, [assignment]);
  const advance = async () => { if (!assignment || !next) return; setBusy(true); try { await crisisApi.updateAssignment(assignment.id, next, next === "EN_ROUTE" ? "Operational response started." : "Status updated from responder mission control."); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Status update failed."); } finally { setBusy(false); } };
  const mapMarkers = compactMarkers([incident ? incidentMarker(incident) : null, pointMarker(selfPoint)]);
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.sectionHeader}><View><Text style={styles.eyebrow}>UNIT / ALPHA RESPONSE</Text><Text style={styles.screenTitle}>Mission Control</Text></View><View style={styles.operationalPill}><View style={styles.onlineDot} /><Text style={styles.onlineText}>AVAILABLE</Text></View></View>{error ? <Notice text={error} tone="error" onPress={refresh} /> : null}<AlertsStrip alerts={alerts} />{!assignment || !incident ? <EmptyState icon="radio-outline" text="No active dispatches assigned to this unit." /> : <><View style={styles.missionBanner}><View style={styles.missionIcon}><Ionicons name="navigate" size={22} color={colors.onBrandPrimary} /></View><View style={styles.flex}><Text style={styles.eyebrow}>ACTIVE ASSIGNMENT</Text><Text style={styles.missionTitle}>{incident.title}</Text></View><Badge text={incident.severity} tone="error" /></View>{mapMarkers.length > 0 ? <CrisisMap testID="responder-map" markers={mapMarkers} height={200} /> : <View style={styles.mapPlaceholder}><Ionicons name="map-outline" size={42} color={colors.brandSecondary} /><Text style={styles.mapTitle}>TACTICAL LOCATION VIEW</Text><Text style={styles.mapText}>{incident.location.source === "CURRENT_GPS" ? "Live GPS coordinates received" : "Location source: " + (incident.location.source ?? "UNKNOWN")}</Text><View style={styles.mapGrid} /></View>}{locationBlocked ? <Notice text="Location sharing is blocked. Open Settings to enable live tracking." tone="info" actionLabel="OPEN" onPress={() => Linking.openSettings()} /> : null}{incident.media && incident.media.length > 0 ? <MediaThumbs media={incident.media} /> : null}<View style={styles.detailGrid}><Detail label="PEOPLE" value={String(incident.affected_people)} icon="people-outline" /><Detail label="STATUS" value={assignment.status.replace("_", " ")} icon="pulse-outline" /><Detail label="CAPABILITIES" value={incident.ai_analysis.required_capabilities.join(" · ").replaceAll("_", " ")} icon="construct-outline" />{incident.reported_by_mobile && <Detail label="CITIZEN PHONE" value={incident.reported_by_mobile} icon="call-outline" />}</View><View style={styles.missionPanel}><Text style={styles.sectionTitle}>MISSION BRIEF</Text><Text style={styles.reviewSummary}>{incident.ai_analysis.summary}</Text><View style={styles.secureRow}><Ionicons name="lock-closed-outline" size={16} color={colors.info} /><Text style={styles.secureText}>Operational location sharing activates during EN ROUTE and ON SCENE.</Text></View><Pressable testID="assignment-advance-button" onPress={advance} disabled={busy || !next} style={({ pressed }) => [styles.approveButton, pressed && styles.pressed, busy && styles.disabled]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name={next === "COMPLETED" ? "checkmark-done" : "arrow-forward-circle"} size={21} color={colors.onBrandPrimary} /><Text style={styles.approveText}>{next === "COMPLETED" ? "COMPLETE ASSIGNMENT" : `MARK ${next?.replace("_", " ")}`}</Text></>}</Pressable></View></>}</ScrollView>;
}

function incidentMarker(incident: Incident): CrisisMapMarker | null {
  const coords = incident.location.coordinates ?? [];
  if (coords.length < 2) return null;
  return { id: `incident-${incident.id}`, latitude: coords[1], longitude: coords[0], kind: "incident", label: incident.title, critical: incident.severity === "CRITICAL" };
}
function responderMarker(responder: Responder): CrisisMapMarker | null {
  const coords = responder.current_location?.coordinates as number[] | undefined;
  if (!coords || coords.length < 2) return null;
  return { id: `responder-${responder.id}`, latitude: coords[1], longitude: coords[0], kind: "responder", label: responder.name };
}
function pointMarker(point: DevicePoint | null): CrisisMapMarker | null {
  const coords = point?.coordinates as number[] | undefined;
  if (!coords || coords.length < 2) return null;
  return { id: "self", latitude: coords[1], longitude: coords[0], kind: "self", label: "Your position" };
}
function locationHistoryTrail(entries: OperatorLocationHistoryEntry[]): CrisisMapPoint[] {
  return entries.slice(-200).flatMap(({ location }) => {
    const coordinates = location.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const [longitude, latitude] = coordinates;
    if (typeof longitude !== "number" || !Number.isFinite(longitude) || typeof latitude !== "number" || !Number.isFinite(latitude)) return [];
    return [{ latitude, longitude }];
  });
}
function compactMarkers(list: (CrisisMapMarker | null)[]): CrisisMapMarker[] {
  return list.filter((marker): marker is CrisisMapMarker => marker !== null);
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "warning" | "error" | "success" }) { const styles = useStyles(); const { colors } = useTheme(); const color = colors[tone]; return <View style={styles.kpi}><Text style={styles.kpiLabel}>{label}</Text><Text style={[styles.kpiValue, { color }]}>{value}</Text></View>; }
function Detail({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) { const styles = useStyles(); const { colors } = useTheme(); return <View style={styles.detail}><Ionicons name={icon} size={17} color={colors.brandSecondary} /><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue} numberOfLines={2}>{value}</Text></View>; }
function IncidentRow({ incident }: { incident: Incident }) { const styles = useStyles(); const { colors } = useTheme(); return <View style={styles.incidentRow}><View style={styles.rowIcon}><Ionicons name="warning-outline" size={18} color={incident.severity === "CRITICAL" ? colors.error : colors.warning} /></View><View style={styles.flex}><Text style={styles.incidentTitle}>{incident.title}</Text><Text style={styles.incidentMeta}>{formatTime(incident.created_at)} · {incident.status.replace("_", " ")}{incident.media?.length ? " · PHOTO" : ""}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></View>; }

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, bootCenter: { alignItems: "center", justifyContent: "center", gap: 16 }, bootText: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 }, pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] }, header: { minHeight: 70, paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomColor: colors.divider, borderBottomWidth: 1 }, brand: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 2 }, headerMeta: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, marginTop: 4 }, headerRight: { flexDirection: "row", alignItems: "center", gap: 16 }, headerActions: { flexDirection: "row", gap: 8 }, online: { borderColor: colors.success, borderWidth: 1, borderRadius: 99, minHeight: 28, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 }, onlineWarn: { borderColor: colors.warning }, onlineDot: { width: 7, height: 7, borderRadius: 7, backgroundColor: colors.success }, onlineText: { color: colors.success, fontSize: 10, fontWeight: "800", letterSpacing: 1 }, content: { padding: 20, paddingBottom: 40, gap: 16 }, sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, eyebrow: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 6 }, screenTitle: { color: colors.onSurface, fontSize: 27, fontWeight: "800", letterSpacing: -0.4 }, locationBadge: { borderColor: colors.border, borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, minHeight: 28, flexDirection: "row", gap: 5, alignItems: "center" }, locationText: { color: colors.success, fontSize: 9, fontWeight: "800" }, sosPanel: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: 20, padding: 24, alignItems: "center", marginTop: 8 }, sosEyebrow: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 }, sosTitle: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 8 }, sosBody: { color: colors.onSurfaceSecondary, textAlign: "center", fontSize: 13, lineHeight: 20, marginTop: 9 }, sosButton: { marginTop: 20, minHeight: 76, minWidth: "80%", borderRadius: 18, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }, sosPressed: { opacity: 0.82, transform: [{ scale: 0.97 }] }, sosButtonText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 18, letterSpacing: 1.3 }, sosHint: { color: colors.onBrandTertiary, fontSize: 11, marginTop: 11 }, sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "900", letterSpacing: 1.4 }, statusCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.warning, borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 8 }, statusTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, statusHeading: { flex: 1, flexShrink: 1 }, statusTitle: { color: colors.onSurface, fontSize: 19, fontWeight: "800" }, statusSummary: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, marginTop: 14 }, mediaSpacing: { marginTop: 14 }, timeline: { marginTop: 20, gap: 0 }, timelineItem: { minHeight: 28, flexDirection: "row", alignItems: "center" }, timelineDot: { width: 18, height: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, timelineDotActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }, timelineText: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.4, marginLeft: 9 }, timelineTextActive: { color: colors.onSurfaceSecondary }, timelineLine: { width: 1, height: 10, backgroundColor: colors.borderStrong, marginLeft: 8.5 }, timelineLineActive: { backgroundColor: colors.brandPrimary }, incidentRow: { minHeight: 64, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 13, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border }, rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, incidentTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "700" }, incidentMeta: { color: colors.muted, fontSize: 11, marginTop: 4 }, infoStrip: { borderTopColor: colors.divider, borderTopWidth: 1, paddingTop: 15, flexDirection: "row", gap: 9, alignItems: "flex-start" }, infoText: { color: colors.muted, fontSize: 12, lineHeight: 18, flex: 1 }, inputLabel: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, fontWeight: "900", marginTop: 19, marginBottom: 9 }, disabled: { opacity: 0.5 }, kpiRow: { flexDirection: "row", gap: 9 }, kpi: { flex: 1, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 13 }, kpiLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1 }, kpiValue: { fontSize: 25, fontWeight: "900", marginTop: 6 }, queueCard: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 15, gap: 8 }, queueCardActive: { borderColor: colors.brandSecondary }, queueTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, queueTime: { color: colors.muted, fontSize: 11 }, queueTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" }, queueDescription: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 }, queueFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 }, queueMeta: { color: colors.muted, fontSize: 11 }, iconButton: { minWidth: 44, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, alignItems: "center", justifyContent: "center" }, reviewPanel: { backgroundColor: colors.surfaceTertiary, borderRadius: 17, borderWidth: 1, borderColor: colors.borderStrong, padding: 16, gap: 12 }, reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, reviewTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" }, reviewSummary: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 }, providerMeta: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 }, capabilityRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, capability: { paddingVertical: 7, paddingHorizontal: 9, backgroundColor: colors.brandTertiary, borderRadius: 8 }, capabilityText: { color: colors.onBrandTertiary, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 }, responderRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderTopColor: colors.divider, borderTopWidth: 1 }, responderIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }, responderName: { color: colors.onSurface, fontSize: 13, fontWeight: "700" }, responderDetail: { color: colors.muted, fontSize: 11, marginTop: 3 }, matchScore: { color: colors.success, fontWeight: "900", fontSize: 16 }, approveButton: { minHeight: 52, borderRadius: 12, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }, approveText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "900", letterSpacing: 0.8 }, approvalNote: { color: colors.muted, textAlign: "center", fontSize: 11 }, assignmentNotice: { backgroundColor: `${colors.success}18`, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }, assignmentTitle: { color: colors.success, fontWeight: "900", fontSize: 13 }, assignmentDetail: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 3 }, operationalPill: { borderColor: colors.success, borderWidth: 1, borderRadius: 99, minHeight: 28, paddingHorizontal: 9, flexDirection: "row", gap: 6, alignItems: "center" }, missionBanner: { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: 17, padding: 15, flexDirection: "row", alignItems: "center", gap: 11 }, missionIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }, missionTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" }, mapPlaceholder: { height: 190, borderRadius: 17, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden" }, mapGrid: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.18, borderWidth: 1, borderColor: colors.info }, mapTitle: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, marginTop: 10 }, mapText: { color: colors.muted, fontSize: 12, marginTop: 6 }, detailGrid: { flexDirection: "row", gap: 8 }, detail: { flex: 1, minHeight: 86, backgroundColor: colors.surfaceSecondary, borderRadius: 13, borderWidth: 1, borderColor: colors.border, padding: 10 }, detailLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1, marginTop: 8 }, detailValue: { color: colors.onSurface, fontSize: 12, fontWeight: "800", marginTop: 4 }, missionPanel: { backgroundColor: colors.surfaceTertiary, borderRadius: 17, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 13 }, secureRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" }, secureText: { color: colors.muted, fontSize: 11, lineHeight: 17, flex: 1 }, flex: { flex: 1 },

  locateAlert: { backgroundColor: `${colors.error}15`, borderWidth: 1, borderColor: colors.error, borderRadius: 15, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  locateAlertText: { flex: 1 },
  locateAlertTitle: { color: colors.error, fontSize: 13, fontWeight: "900", letterSpacing: 0.5 },
  locateAlertSubtitle: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 3 },
  locateAlertDismiss: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.error, borderRadius: 8 },
  locateAlertDismissText: { color: colors.onError, fontSize: 11, fontWeight: "900" },

  operatorAssignedCard: { backgroundColor: `${colors.success}15`, borderWidth: 1, borderColor: colors.success, borderRadius: 15, padding: 14, marginTop: 12 },
  operatorAssignedHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  operatorAssignedTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  operatorAssignedMeta: { color: colors.success, fontSize: 12, fontWeight: "700", marginTop: 6 },
  operatorAssignedNote: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 4 },

  operatorAssignmentCard: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: 17, padding: 16, gap: 12, marginBottom: 8 },
  assignmentHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  assignmentIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  operatorAssignmentTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  assignmentMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  assignmentSummary: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 },
  assignmentActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  actionButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44, paddingHorizontal: 12, borderRadius: 11, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary },
  actionButtonText: { color: colors.onBrandTertiary, fontSize: 12, fontWeight: "900", letterSpacing: 0.5 },
  actionButtonSecondary: { backgroundColor: colors.surfaceTertiary, borderColor: colors.brandSecondary },
  actionButtonSuccess: { backgroundColor: `${colors.success}18`, borderColor: colors.success },
  actionButtonDanger: { backgroundColor: colors.error + "18", borderColor: colors.error },
  nearestPanel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 16, gap: 12, marginBottom: 8 },
  locationWaiting: { flexDirection: "row", alignItems: "center", gap: 8 },
  waitingText: { color: colors.muted, fontSize: 12 },
  locationStatusWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  locationPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  locationPillActive: { backgroundColor: `${colors.success}18`, borderColor: colors.success },
  locationPillPast: { backgroundColor: `${colors.warning}18`, borderColor: colors.warning },
  locationPillText: { color: colors.success, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  locationPastNotice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: `${colors.warning}18`, borderWidth: 1, borderColor: colors.warning, borderRadius: 12, padding: 10 },
  locationPastText: { flex: 1, color: colors.warning, fontSize: 11, lineHeight: 16 },
  locationTrailCaption: { color: colors.brandSecondary, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: -8, marginBottom: -4 },
  loadingRow: { alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  nearestList: { gap: 8 },
  nearestCard: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  nearestCardLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  nearestCardCenter: { flex: 1, flexShrink: 1 },
  nearestCardRight: { width: 32 },
  nearestDistance: { color: colors.brandSecondary, fontSize: 11, fontWeight: "800" },
  nearestTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  nearestMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  nearestMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 },
  queueMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 },
  reviewMobileRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  reviewMobileText: { color: colors.brandSecondary, fontSize: 12, fontWeight: "700" },

  alertsManagementPanel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 16, gap: 12, marginBottom: 8 },
  alertsManagementList: { gap: 8 },
  alertManagementCard: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, gap: 10 },
  alertManagementLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  alertSeverityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 2, flexShrink: 0 },
  alertManagementInfo: { flex: 1, minWidth: 0 },
  alertManagementTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  alertManagementMeta: { color: colors.muted, fontSize: 10, marginTop: 2 },
  alertManagementMessage: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16, marginTop: 4 },
  deactivateButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.error + "18", borderWidth: 1, borderColor: colors.error },
  deactivateButtonText: { color: colors.error, fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
}));
