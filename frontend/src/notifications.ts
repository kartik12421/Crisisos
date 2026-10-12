import { Platform } from "react-native";
import Constants from "expo-constants";

export type EmergencyNotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  id: string;
};

type NotificationListener = (payload: EmergencyNotificationPayload) => void;
const listeners: Set<NotificationListener> = new Set();

export function onEmergencyNotification(listener: NotificationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Safely resolve expo-notifications module to prevent crashes in Expo Go (SDK 53+)
let Notifications: typeof import("expo-notifications") | null = null;
const isExpoGo = Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";

if (Platform.OS !== "web" && !isExpoGo) {
  try {
    Notifications = require("expo-notifications");
    if (Notifications?.setNotificationHandler) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
    }
  } catch (err) {
    console.warn("expo-notifications unavailable in current runtime:", err);
  }
}

/**
 * Request notification permissions and setup high-priority channel on Android
 */
export async function setupNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") return true;
        if (Notification.permission !== "denied") {
          const perm = await Notification.requestPermission();
          return perm === "granted";
        }
      }
      return false;
    }

    if (!Notifications) return false;

    // Android Notification Channel with HIGH importance for popup banner & sound
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("emergency-sos", {
        name: "Emergency SOS Alerts",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: "#FF2B2B",
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === "granted";
  } catch (error) {
    console.warn("Error setting up notifications:", error);
    return false;
  }
}

/**
 * Show a popup notification in the system notification bar AND in-app popup banner for Emergency SOS / Alerts
 */
export async function triggerEmergencyNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const payload: EmergencyNotificationPayload = {
    title,
    body,
    data,
    id: String(Date.now() + Math.random()),
  };

  // 1. Notify in-app pop-up listeners immediately (works 100% in Expo Go, Android, iOS, Web)
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      /* ignore listener error */
    }
  });

  // 2. System bar / OS notification
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification(title, {
            body,
            icon: "/favicon.ico",
            tag: "emergency-sos",
          });
        }
      }
      return;
    }

    if (Notifications) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: data || {},
          sound: "default",
          priority: Notifications.AndroidNotificationPriority.MAX,
          categoryIdentifier: "EMERGENCY",
        },
        trigger: null,
      });
    }
  } catch (error) {
    console.warn("Failed to trigger OS emergency notification popup:", error);
  }
}
