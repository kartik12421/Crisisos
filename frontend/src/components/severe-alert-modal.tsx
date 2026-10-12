import { useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { getCachedSession, subscribeEvents } from "@/src/crisis-api";
import { makeStyles, useTheme } from "@/src/theme";

// Safely resolve expo-av at runtime to avoid Metro HMR cache miss
let AudioModule: typeof import("expo-av")["Audio"] | null = null;
try {
  AudioModule = require("expo-av").Audio;
} catch {
  /* fallback to web audio */
}

export type SevereAlertData = {
  id: string;
  title: string;
  message: string;
  severity: string;
  radius_km?: number;
  created_at?: string;
};

let globalShowSevereAlert: ((data: SevereAlertData) => void) | null = null;

export function triggerSevereAlert(data: SevereAlertData) {
  if (globalShowSevereAlert) {
    globalShowSevereAlert(data);
  }
}

const ALARM_SOUND_URL = "https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg";

export function SevereAlertModal() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [currentAlert, setCurrentAlert] = useState<SevereAlertData | null>(null);

  const soundRef = useRef<any>(null);
  const audioCtxRef = useRef<any>(null);
  const sirenIntervalRef = useRef<any>(null);
  const vibrationIntervalRef = useRef<any>(null);

  useEffect(() => {
    globalShowSevereAlert = (data: SevereAlertData) => {
      setCurrentAlert(data);
      void startAlarmSoundAndVibration();
    };

    const unsubscribe = subscribeEvents((event) => {
      // Show the live broadcast popup for WARNING / CRITICAL operator alerts even
      // when the session belongs to the sender, because the app must display the
      // message it just received.
      if (
        event.type === "alert.created" ||
        event.type === "alert.published"
      ) {
        const raw = event.payload || {};
        const payload = (raw.payload || raw) as Record<string, any>;
        const severityText = String(payload.severity || raw.severity || "CRITICAL").toUpperCase();

        if (severityText === "INFO") {
          return;
        }

        const titleText = String(
          payload.title || raw.title || payload.alert_title || raw.alert_title || `${severityText} EMERGENCY ALERT`
        ).trim();
        const messageText = String(
          payload.message || raw.message || payload.description || raw.description ||
          "Emergency command received from Operator."
        ).trim();

        const radiusNum = payload.radius_km ?? raw.radius_km;
        triggerSevereAlert({
          id: String(payload.alert_id || payload.id || raw.alert_id || raw.id || Date.now()),
          title: titleText,
          message: messageText,
          severity: severityText,
          radius_km: radiusNum !== undefined && radiusNum !== null && radiusNum !== "" ? Number(radiusNum) : undefined,
        });
      }
    });

    return () => {
      globalShowSevereAlert = null;
      unsubscribe();
      void stopAlarmSoundAndVibration();
    };
  }, []);

  const startAlarmSoundAndVibration = async () => {
    await stopAlarmSoundAndVibration();

    // 1. Continuous Haptic Vibration
    vibrationIntervalRef.current = setInterval(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    }, 500);

    // 2. Play Loud Emergency Siren via expo-av if available
    if (AudioModule) {
      try {
        await AudioModule.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
        });

        const sound = new AudioModule.Sound();
        soundRef.current = sound;
        await sound.loadAsync({ uri: ALARM_SOUND_URL }, { shouldPlay: true, isLooping: true, volume: 1.0 });
        await sound.playAsync();
        return;
      } catch (err) {
        console.warn("expo-av playback error:", err);
      }
    }

    // 3. Web Audio API Oscillator Fallback
    try {
      if (typeof window !== "undefined") {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          audioCtxRef.current = audioCtx;

          let highFreq = true;
          sirenIntervalRef.current = setInterval(() => {
            if (audioCtx.state === "suspended") {
              void audioCtx.resume();
            }
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(highFreq ? 980 : 720, audioCtx.currentTime);
            highFreq = !highFreq;

            gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
          }, 320);
        }
      }
    } catch (e) {
      console.warn("Web Audio fallback error:", e);
    }
  };

  const stopAlarmSoundAndVibration = async () => {
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }

    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {
        /* ignore */
      }
      soundRef.current = null;
    }

    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    }
  };

  const handleDismiss = () => {
    void stopAlarmSoundAndVibration();
    setCurrentAlert(null);
  };

  if (!currentAlert) return null;

  return (
    <Modal
      visible={true}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.cardContainer}>
          {/* Top Urgent Alert Bar */}
          <View style={styles.topUrgencyBar} />

          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="warning" size={26} color="#FFFFFF" />
            </View>
            <View style={styles.titleColumn}>
              <Text style={styles.eyebrow}>
                OPERATOR BROADCAST · {currentAlert.severity}
                {currentAlert.radius_km ? ` · ${currentAlert.radius_km} KM RADIUS` : ""}
              </Text>
              <Text style={styles.alertTitle} numberOfLines={2}>
                {currentAlert.title}
              </Text>
            </View>
          </View>

          {/* Operator Command / Message Content */}
          <View style={styles.messageBox}>
            <Text style={styles.operatorMessage}>
              {currentAlert.message}
            </Text>
          </View>

          {/* Stop Alarm Action Button */}
          <Pressable
            testID="stop-alarm-button"
            onPress={handleDismiss}
            style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
          >
            <Ionicons name="volume-mute-outline" size={20} color={colors.onBrandPrimary} style={styles.buttonIcon} />
            <Text style={styles.stopButtonText}>STOP ALARM / OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.85)",
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
    },
    cardContainer: {
      width: "100%",
      maxWidth: 400,
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 22,
      borderWidth: 1.5,
      borderColor: colors.error,
      elevation: 20,
      shadowColor: colors.error,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.45,
      shadowRadius: 16,
      overflow: "hidden",
    },
    topUrgencyBar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 5,
      backgroundColor: colors.error,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 16,
      marginTop: 4,
    },
    iconCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.error,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 14,
    },
    titleColumn: {
      flex: 1,
    },
    eyebrow: {
      color: colors.error,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1.2,
      marginBottom: 2,
    },
    alertTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.onSurface,
      letterSpacing: 0.2,
    },
    messageBox: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 14,
      padding: 16,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    operatorMessage: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.onSurface,
      fontWeight: "600",
    },
    stopButton: {
      backgroundColor: colors.error,
      borderRadius: 12,
      paddingVertical: 14,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
    },
    buttonIcon: {
      marginRight: 8,
    },
    stopButtonText: {
      color: colors.onBrandPrimary,
      fontSize: 15,
      fontWeight: "900",
      letterSpacing: 0.8,
    },
    pressed: {
      opacity: 0.8,
    },
  })
);
