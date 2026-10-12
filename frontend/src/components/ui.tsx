// Shared UI primitives used across role workspaces and composers.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { authHeaders, IncidentMedia, rawMediaUrl, signMediaUrl } from "@/src/crisis-api";
import { makeStyles, useTheme } from "@/src/theme";

export function Notice({ text, tone, onPress, actionLabel = "RETRY" }: { text: string; tone: "error" | "info"; onPress?: () => void; actionLabel?: string }) {
  const styles = useStyles(); const { colors } = useTheme();
  return <Pressable onPress={onPress} style={[styles.notice, { borderColor: tone === "error" ? colors.error : colors.info }]}><Ionicons name={tone === "error" ? "alert-circle-outline" : "information-circle-outline"} size={18} color={tone === "error" ? colors.error : colors.info} /><Text style={styles.noticeText}>{text}</Text>{onPress ? <Text style={styles.retry}>{actionLabel}</Text> : null}</Pressable>;
}

export function Badge({ text, tone }: { text: string; tone: "error" | "warning" | "success" | "info" }) {
  const styles = useStyles(); const { colors } = useTheme(); const color = colors[tone];
  return <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}22` }]}><Text style={[styles.badgeText, { color }]}>{text}</Text></View>;
}

export function EmptyState({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const styles = useStyles(); const { colors } = useTheme();
  return <View style={styles.empty}><Ionicons name={icon} size={32} color={colors.muted} /><Text style={styles.emptyText}>{text}</Text></View>;
}

/**
 * Incident photo evidence thumbnails. Native sends the JWT as an image header;
 * web <img> cannot send headers, so it swaps in a short-lived signed URL
 * (raw JWTs never appear in URLs).
 */
function MediaImage({ item }: { item: IncidentMedia }) {
  const styles = useStyles();
  const [uri, setUri] = useState<string | null>(Platform.OS === "web" ? null : rawMediaUrl(item.path));
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let live = true;
    signMediaUrl(item.path).then((url) => { if (live) setUri(url); }).catch(() => undefined);
    return () => { live = false; };
  }, [item.path]);
  if (!uri) return <View style={[styles.mediaThumb, styles.mediaLoading]} />;
  return (
    <Image
      testID={`media-thumb-${item.path}`}
      source={Platform.OS === "web" ? { uri } : { uri, headers: authHeaders() }}
      style={styles.mediaThumb}
      contentFit="cover"
      transition={150}
    />
  );
}

export function MediaThumbs({ media }: { media: IncidentMedia[] }) {
  const styles = useStyles();
  if (media.length === 0) return null;
  return (
    <View style={styles.mediaRow}>
      {media.map((item) => <MediaImage key={item.path} item={item} />)}
    </View>
  );
}

export function formatTime(value: string) { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

const useStyles = makeStyles((colors) => StyleSheet.create({
  notice: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  noticeText: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, flex: 1 },
  retry: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900" },
  badge: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5, alignSelf: "flex-start", flexShrink: 0 },
  badgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  empty: { minHeight: 150, borderWidth: 1, borderColor: colors.border, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 12, padding: 20 },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  mediaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mediaThumb: { width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary },
  mediaLoading: { opacity: 0.5 },
}));
