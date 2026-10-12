// Command Center analytics panel — dependency-free bars (web + Expo Go safe).
import { StyleSheet, Text, View } from "react-native";

import { Analytics } from "@/src/crisis-api";
import { makeStyles, useTheme } from "@/src/theme";

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const styles = useStyles();
  const width = `${Math.max(4, Math.round((value / Math.max(1, max)) * 100))}%` as const;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}><View style={[styles.barFill, { width, backgroundColor: color }]} /></View>
      <Text style={styles.barValue}>{value}</Text>
    </View>
  );
}

export function AnalyticsPanel({ analytics }: { analytics: Analytics | null }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!analytics) return null;
  const byType = Object.entries(analytics.by_type ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const bySeverity = Object.entries(analytics.by_severity ?? {}).sort((a, b) => b[1] - a[1]);
  const severityColor = (key: string) => (key === "CRITICAL" ? colors.error : key === "HIGH" ? colors.warning : colors.info);
  return (
    <View style={styles.panel} testID="analytics-panel">
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>AVG RESOLUTION</Text>
          <Text style={styles.statValue}>{analytics.avg_resolution_minutes != null ? `${analytics.avg_resolution_minutes} min` : "—"}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>RESPONDERS READY</Text>
          <Text style={styles.statValue}>{analytics.responders_available ?? 0}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>ACTIVE ALERTS</Text>
          <Text style={styles.statValue}>{analytics.active_alerts ?? 0}</Text>
        </View>
      </View>
      {byType.length > 0 ? (
        <View>
          <Text style={styles.groupLabel}>INCIDENTS BY TYPE</Text>
          {byType.map(([key, value]) => <BarRow key={key} label={key.replaceAll("_", " ")} value={value} max={byType[0][1]} color={colors.brandSecondary} />)}
        </View>
      ) : null}
      {bySeverity.length > 0 ? (
        <View>
          <Text style={styles.groupLabel}>BY SEVERITY</Text>
          {bySeverity.map(([key, value]) => <BarRow key={key} label={key} value={value} max={bySeverity[0][1]} color={severityColor(key)} />)}
        </View>
      ) : null}
      {byType.length === 0 && bySeverity.length === 0 ? <Text style={styles.emptyText}>No operational data yet — analytics populate as incidents flow in.</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  panel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 15, gap: 14 },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 11 },
  statLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  statValue: { color: colors.onSurface, fontSize: 17, fontWeight: "900", marginTop: 6 },
  groupLabel: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 8 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 },
  barLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", width: 92 },
  barTrack: { flex: 1, height: 10, borderRadius: 6, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 6 },
  barValue: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "800", width: 26, textAlign: "right" },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
}));
