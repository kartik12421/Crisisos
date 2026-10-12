// Citizen SOS composer: emergency type, description, people count, optional photo
// evidence (camera/gallery with contextual permissions), offline queueing, and
// keyboard-safe scrolling.
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as Crypto from "expo-crypto";

import { crisisApi, EmergencyType, enqueueSos, Incident, isNetworkError, SosPayload } from "@/src/crisis-api";
import { ensureLocationPermission, getDeviceLocation, LocationPermission } from "@/src/location";
import { setupNotifications, triggerEmergencyNotification } from "@/src/notifications";
import { makeStyles, useTheme } from "@/src/theme";
import { Notice } from "./ui";

const emergencyTypes: { key: EmergencyType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "BUILDING_COLLAPSE", label: "Collapse", icon: "business-outline" },
  { key: "TRAPPED_PERSON", label: "Trapped", icon: "people-outline" },
  { key: "MEDICAL", label: "Medical", icon: "medkit-outline" },
  { key: "FIRE", label: "Fire", icon: "flame-outline" },
];

type PhotoState = { uri: string; path: string | null; uploading: boolean } | null;

export function SosComposer({ visible, onClose, onCreated, onQueued }: { visible: boolean; onClose: () => void; onCreated: (incident: Incident) => void; onQueued: (count: number) => void }) {
  const styles = useStyles(); const { colors } = useTheme();
  const [type, setType] = useState<EmergencyType>("BUILDING_COLLAPSE"); const [description, setDescription] = useState(""); const [people, setPeople] = useState("1"); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [locationPermission, setLocationPermission] = useState<LocationPermission | "unknown">("unknown");
  const [photo, setPhoto] = useState<PhotoState>(null);
  const [mediaBlocked, setMediaBlocked] = useState(false);
  // Opening the composer is clear intent — ask for location now, contextually.
  useEffect(() => { if (visible) { setLocationPermission("unknown"); void ensureLocationPermission().then(setLocationPermission); } }, [visible]);

  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    setPhoto({ uri: asset.uri, path: null, uploading: true });
    try {
      const uploaded = await crisisApi.uploadMedia({ uri: asset.uri, fileName: asset.fileName, mimeType: asset.mimeType });
      setPhoto({ uri: asset.uri, path: uploaded.path, uploading: false });
    } catch (e) {
      setPhoto(null);
      setError(e instanceof Error ? e.message : "Photo upload failed. You can still send the SOS.");
    }
  };

  const pickFromCamera = async () => {
    setMediaBlocked(false);
    const current = await ImagePicker.getCameraPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await ImagePicker.requestCameraPermissionsAsync()).granted;
    if (!granted) { setMediaBlocked(true); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ["images"] });
    if (!result.canceled && result.assets[0]) void uploadAsset(result.assets[0]);
  };

  const pickFromGallery = async () => {
    setMediaBlocked(false);
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await ImagePicker.requestMediaLibraryPermissionsAsync()).granted;
    if (!granted) { setMediaBlocked(true); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ["images"] });
    if (!result.canceled && result.assets[0]) void uploadAsset(result.assets[0]);
  };

  const submit = async () => {
    setSaving(true); setError("");
    const payload: SosPayload = { emergency_type: type, description, affected_people: Math.max(1, Number(people) || 1), idempotency_key: Crypto.randomUUID(), location: await getDeviceLocation(), media_paths: photo?.path ? [photo.path] : [] };
    try {
      await setupNotifications();
      const res = await crisisApi.createSos(payload);
      void triggerEmergencyNotification(
        "🚨 EMERGENCY SOS BROADCASTED",
        `Emergency Alert (${type}): Help requested for ${people} person(s). Location sent.`,
        { sos_id: res.id, emergency_type: type }
      );
      onCreated(res);
    } catch (e) {
      if (isNetworkError(e)) {
        await setupNotifications();
        const queued = await enqueueSos(payload);
        void triggerEmergencyNotification(
          "🚨 EMERGENCY SOS QUEUED (OFFLINE)",
          `Emergency (${type}) queued locally. Will auto-dispatch when network reconnects.`,
          { emergency_type: type }
        );
        onQueued(queued);
      }
      else { setError(e instanceof Error ? e.message : "SOS could not be sent."); }
    } finally { setSaving(false); }
  };

  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}><View style={styles.modalBackdrop}><KeyboardAwareScrollView style={styles.modalCard} contentContainerStyle={styles.modalCardContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bottomOffset={16}><View style={styles.modalHandle} /><View style={styles.modalHeader}><View><Text style={styles.eyebrow}>NEW EMERGENCY</Text><Text style={styles.modalTitle}>Send an SOS</Text></View><Pressable testID="close-sos-modal" onPress={onClose} accessibilityRole="button" hitSlop={8}><Ionicons name="close" size={24} color={colors.muted} /></Pressable></View><Text style={styles.inputLabel}>WHAT IS HAPPENING?</Text><View style={styles.typeGrid}>{emergencyTypes.map((item) => <Pressable key={item.key} testID={`sos-type-${item.key.toLowerCase().replaceAll("_", "-")}`} onPress={() => setType(item.key)} style={[styles.typeChip, type === item.key && styles.typeChipActive]}><Ionicons name={item.icon} size={17} color={type === item.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} /><Text style={[styles.typeText, type === item.key && styles.typeTextActive]}>{item.label}</Text></Pressable>)}</View><Text style={styles.inputLabel}>DESCRIPTION <Text style={styles.optional}>(OPTIONAL)</Text></Text><TextInput testID="sos-description-input" value={description} onChangeText={setDescription} multiline placeholder="Tell responders what they should know..." placeholderTextColor={colors.muted} style={styles.textInput} /><Text style={styles.inputLabel}>PEOPLE AFFECTED</Text><View style={styles.peopleRow}><Pressable testID="sos-people-decrease" onPress={() => setPeople(String(Math.max(1, Number(people) - 1)))} style={styles.stepper}><Text style={styles.stepperText}>−</Text></Pressable><Text style={styles.peopleValue}>{people}</Text><Pressable testID="sos-people-increase" onPress={() => setPeople(String(Math.min(500, Number(people) + 1)))} style={styles.stepper}><Text style={styles.stepperText}>+</Text></Pressable></View><Text style={styles.inputLabel}>PHOTO EVIDENCE <Text style={styles.optional}>(OPTIONAL)</Text></Text>{photo ? <View style={styles.photoRow}><View><Image testID="sos-photo-preview" source={{ uri: photo.uri }} style={styles.photoImage} contentFit="cover" />{photo.uploading ? <View style={styles.photoUploading}><ActivityIndicator color={colors.onBrandPrimary} size="small" /></View> : null}</View><View style={styles.photoMeta}><Text style={styles.photoStatus}>{photo.uploading ? "Uploading photo…" : "Photo attached — operators will see it."}</Text><Pressable testID="sos-photo-remove" onPress={() => setPhoto(null)} style={styles.photoRemove}><Ionicons name="trash-outline" size={15} color={colors.error} /><Text style={styles.photoRemoveText}>REMOVE</Text></Pressable></View></View> : <View style={styles.photoButtons}><Pressable testID="sos-photo-camera" onPress={pickFromCamera} style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}><Ionicons name="camera-outline" size={18} color={colors.brandSecondary} /><Text style={styles.photoButtonText}>CAMERA</Text></Pressable><Pressable testID="sos-photo-gallery" onPress={pickFromGallery} style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}><Ionicons name="images-outline" size={18} color={colors.brandSecondary} /><Text style={styles.photoButtonText}>GALLERY</Text></Pressable></View>}{mediaBlocked ? <Pressable testID="media-settings-button" onPress={() => Linking.openSettings()} style={styles.permissionRow}><Ionicons name="images-outline" size={17} color={colors.warning} /><Text style={styles.permissionText}>Photo access is blocked. Open Settings to attach evidence.</Text><Text style={styles.openText}>OPEN</Text></Pressable> : null}{locationPermission === "blocked" ? <Pressable testID="location-settings-button" onPress={() => Linking.openSettings()} style={styles.permissionRow}><Ionicons name="location-outline" size={17} color={colors.warning} /><Text style={styles.permissionText}>Location is blocked. Open Settings so responders can find you.</Text><Text style={styles.openText}>OPEN</Text></Pressable> : null}{error ? <Notice text={error} tone="error" /> : null}<Pressable testID="confirm-sos-button" onPress={submit} disabled={saving || (photo?.uploading ?? false)} style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed, (saving || (photo?.uploading ?? false)) && styles.disabled]}>{saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="radio" size={20} color={colors.onBrandPrimary} /><Text style={styles.confirmText}>CONFIRM SOS</Text></>}</Pressable><Text style={styles.confirmNote}>{saving ? "AI triage in progress — hold on." : "You will see SOS ACKNOWLEDGED only after server confirmation."}</Text></KeyboardAwareScrollView></View></Modal>;
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  modalCard: { flexGrow: 0, backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  modalCardContent: { padding: 20, paddingBottom: 30 },
  modalHandle: { alignSelf: "center", width: 42, height: 4, borderRadius: 4, backgroundColor: colors.borderStrong, marginBottom: 18 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 6 },
  modalTitle: { color: colors.onSurface, fontSize: 24, fontWeight: "800" },
  inputLabel: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, fontWeight: "900", marginTop: 19, marginBottom: 9 },
  optional: { color: colors.onSurfaceTertiary, fontWeight: "500" },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6 },
  typeChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  typeTextActive: { color: colors.onBrandPrimary },
  textInput: { minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, backgroundColor: colors.surfaceTertiary, padding: 12, textAlignVertical: "top", fontSize: 14 },
  peopleRow: { flexDirection: "row", alignItems: "center", gap: 20 },
  stepper: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stepperText: { color: colors.onSurface, fontSize: 24 },
  peopleValue: { color: colors.onSurface, fontSize: 18, fontWeight: "800", minWidth: 24, textAlign: "center" },
  photoButtons: { flexDirection: "row", gap: 8 },
  photoButton: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  photoButtonText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  photoRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  photoImage: { width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  photoUploading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  photoMeta: { flex: 1, gap: 10 },
  photoStatus: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17 },
  photoRemove: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 },
  photoRemoveText: { color: colors.error, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  permissionRow: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.warning, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 14 },
  permissionText: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, flex: 1 },
  openText: { color: colors.brandSecondary, fontSize: 10, fontWeight: "900" },
  confirmButton: { marginTop: 22, minHeight: 52, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
  confirmText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  confirmNote: { color: colors.muted, textAlign: "center", fontSize: 11, marginTop: 10 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
}));
