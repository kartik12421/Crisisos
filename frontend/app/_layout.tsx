import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { NotificationPopupBanner } from "@/src/components/notification-popup";
import { SevereAlertModal } from "@/src/components/severe-alert-modal";
import { subscribeEvents } from "@/src/crisis-api";
import { setupNotifications, triggerEmergencyNotification } from "@/src/notifications";
import { queryClient } from "@/src/query-client";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  useEffect(() => {
    void setupNotifications();

    const unsubscribe = subscribeEvents((event) => {
      if (event.type === "alert.created" || event.type === "alert.published") {
        const raw = event.payload || {};
        const payload = (raw.payload || raw) as Record<string, any>;
        const severityText = String(payload.severity || raw.severity || "CRITICAL").toUpperCase();
        if (severityText !== "INFO") {
          const title = String(payload.title || raw.title || "EMERGENCY SEVERE ALERT");
          const message = String(payload.message || raw.message || "New emergency broadcast received.");
          void triggerEmergencyNotification(title, message, payload);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <NotificationPopupBanner />
          <SevereAlertModal />
          <Stack screenOptions={{ headerShown: false }} />
        </KeyboardProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
