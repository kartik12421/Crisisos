// Operator modal for publishing geofenced emergency alerts to citizens.
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { AlertSeverity, crisisApi } from "@/src/crisis-api";
import { makeStyles, useTheme } from "@/src/theme";
import { Notice } from "./ui";

const severities: { key: AlertSeverity; label: string }[] = [
  { key: "INFO", label: "Info" },
  { key: "WARNING", label: "Warning" },
  { key: "CRITICAL", label: "Critical" },
];

export function AlertComposer({ visible, onClose, onPublished }: { visible: boolean; onClose: () => void; onPublished: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<AlertSeverity>("WARNING");
  const [radius, setRadius] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const radiusKm = radius.trim() ? Number(radius) : null;
      if (radius.trim() && (Number.isNaN(radiusKm) || (radiusKm ?? 0) <= 0)) throw new Error("Radius must be a positive number of kilometers.");
      await crisisApi.publishAlert({ title: title.trim(), message: message.trim(), severity, radius_km: radiusKm });
      setTitle(""); setMessage(""); setRadius(""); setSeverity("WARNING");
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Alert could not be published.");
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAwareScrollView style={styles.card} contentContainerStyle={styles.cardContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bottomOffset={16}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View><Text style={styles.eyebrow}>BROADCAST</Text><Text style={styles.title}>Publish emergency alert</Text></View>
            <Pressable testID="close-alert-modal" onPress={onClose} accessibilityRole="button" hitSlop={8}><Ionicons name="close" size={24} color={colors.muted} /></Pressable>
          </View>
          <Text style={styles.label}>SEVERITY</Text>
          <View style={styles.severityRow}>
            {severities.map((item) => (
              <Pressable key={item.key} testID={`alert-severity-${item.key.toLowerCase()}`} onPress={() => setSeverity(item.key)} style={[styles.severityChip, severity === item.key && styles.severityActive]}>
                <Text style={[styles.severityText, severity === item.key && styles.severityTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>TITLE</Text>
          <TextInput testID="alert-title-input" value={title} onChangeText={setTitle} placeholder="e.g. Flash flood warning — Sector 12" placeholderTextColor={colors.muted} style={styles.input} />
          <Text style={styles.label}>MESSAGE</Text>
          <TextInput testID="alert-message-input" value={message} onChangeText={setMessage} placeholder="Instructions for citizens in the affected area..." placeholderTextColor={colors.muted} multiline style={styles.textArea} />
          <Text style={styles.label}>RADIUS (KM) <Text style={styles.optional}>(OPTIONAL)</Text></Text>
          <TextInput testID="alert-radius-input" value={radius} onChangeText={setRadius} placeholder="e.g. 5" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={styles.input} />
          {error ? <Notice text={error} tone="error" /> : null}
          <Pressable testID="alert-submit-button" onPress={submit} disabled={busy || title.trim().length < 3 || message.trim().length < 3} style={({ pressed }) => [styles.submit, pressed && styles.pressed, (busy || title.trim().length < 3 || message.trim().length < 3) && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="megaphone-outline" size={19} color={colors.onBrandPrimary} /><Text style={styles.submitText}>PUBLISH ALERT</Text></>}
          </Pressable>
          <Text style={styles.note}>Alerts are broadcast in real time to all connected citizen and responder apps.</Text>
        </KeyboardAwareScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  card: { flexGrow: 0, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  cardContent: { padding: 20, paddingBottom: 30 },
  handle: { alignSelf: "center", width: 42, height: 4, borderRadius: 4, backgroundColor: colors.borderStrong, marginBottom: 18 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 6 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, fontWeight: "900", marginTop: 17, marginBottom: 9 },
  optional: { color: colors.onSurfaceTertiary, fontWeight: "500" },
  severityRow: { flexDirection: "row", gap: 8 },
  severityChip: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  severityActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  severityText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  severityTextActive: { color: colors.onBrandPrimary },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 14, fontSize: 14 },
  textArea: { minHeight: 88, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surfaceTertiary, padding: 12, textAlignVertical: "top", fontSize: 14 },
  submit: { marginTop: 20, minHeight: 52, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
  submitText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  note: { color: colors.muted, textAlign: "center", fontSize: 11, marginTop: 10 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
}));
