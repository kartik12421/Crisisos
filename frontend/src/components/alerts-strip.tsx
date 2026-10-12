// Active emergency alerts banner stack — shown to citizens and responders.
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { CrisisAlert } from "@/src/crisis-api";
import { makeStyles, useTheme } from "@/src/theme";

export function AlertsStrip({ alerts }: { alerts: CrisisAlert[] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (alerts.length === 0) return null;
  const toneFor = (severity: string) => (severity === "CRITICAL" ? colors.error : severity === "WARNING" ? colors.warning : colors.info);
  return (
    <View style={styles.stack} testID="alerts-strip">
      {alerts.slice(0, 3).map((alert) => {
        const tone = toneFor(alert.severity);
        return (
          <View key={alert.id} testID={`alert-item-${alert.id}`} style={[styles.banner, { borderColor: tone, backgroundColor: `${tone}14` }]}>
            <Ionicons name="megaphone-outline" size={18} color={tone} />
            <View style={styles.flex}>
              <Text style={[styles.title, { color: tone }]}>{alert.title}</Text>
              <Text style={styles.message}>{alert.message}</Text>
              <Text style={styles.meta}>{alert.severity}{alert.radius_km ? ` · ${alert.radius_km} KM RADIUS` : ""} · {new Date(alert.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  stack: { gap: 8 },
  banner: { borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  flex: { flex: 1 },
  title: { fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },
  message: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  meta: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 0.8, marginTop: 7 },
}));
