import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmergencyNotificationPayload, onEmergencyNotification } from "@/src/notifications";
import { makeStyles, useTheme } from "@/src/theme";

export function NotificationPopupBanner() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [activePayload, setActivePayload] = useState<EmergencyNotificationPayload | null>(null);
  const [translateY] = useState(new Animated.Value(-150));

  useEffect(() => {
    const unsubscribe = onEmergencyNotification((payload) => {
      setActivePayload(payload);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);

      // Slide down animation
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 6,
        tension: 80,
      }).start();

      // Auto dismiss after 6 seconds
      const timer = setTimeout(() => {
        dismiss();
      }, 6000);

      return () => clearTimeout(timer);
    });

    return () => unsubscribe();
  }, []);

  const dismiss = () => {
    Animated.timing(translateY, {
      toValue: -150,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setActivePayload(null);
    });
  };

  if (!activePayload) return null;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeContainer} pointerEvents="box-none">
      <Animated.View style={[styles.banner, { transform: [{ translateY }] }]}>
        <View style={styles.contentRow}>
          <View style={styles.iconCircle}>
            <Ionicons name="warning" size={22} color="#FFFFFF" />
          </View>
          <View style={styles.textColumn}>
            <Text style={styles.title} numberOfLines={1}>
              {activePayload.title}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {activePayload.body}
            </Text>
          </View>
          <Pressable onPress={dismiss} hitSlop={12} style={styles.closeButton}>
            <Ionicons name="close-circle" size={22} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    safeContainer: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 99999,
      alignItems: "center",
    },
    banner: {
      width: "92%",
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.error,
      borderRadius: 16,
      padding: 14,
      marginTop: 8,
      shadowColor: colors.error,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 10,
    },
    contentRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    iconCircle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.error,
      justifyContent: "center",
      alignItems: "center",
      marginRight: 12,
    },
    textColumn: {
      flex: 1,
      marginRight: 8,
    },
    title: {
      color: colors.error,
      fontWeight: "800",
      fontSize: 14,
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    body: {
      color: colors.onSurface,
      fontSize: 13,
      fontWeight: "500",
      lineHeight: 17,
    },
    closeButton: {
      padding: 2,
    },
  })
);
