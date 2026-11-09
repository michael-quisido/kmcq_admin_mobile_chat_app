import * as Notifications from "expo-notifications";
import {
  configureNotifications,
  handleNotificationReceived,
  handleNotificationResponse,
  registerForPushIfPermitted,
} from "./push";
import { loadSoundsEnabled } from "./preferences";

export function initialiseNotifications(): () => void {
  void loadSoundsEnabled();
  configureNotifications().catch(() => {});

  try {
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) {
      handleNotificationResponse(lastResponse, false);
      Notifications.clearLastNotificationResponse();
    }
  } catch {
    // Some runtimes cannot read the last notification response.
  }

  const received = Notifications.addNotificationReceivedListener(handleNotificationReceived);
  const response = Notifications.addNotificationResponseReceivedListener((notificationResponse) => {
    handleNotificationResponse(notificationResponse);
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // Clearing the last response is best effort.
    }
  });
  let token: ReturnType<typeof Notifications.addPushTokenListener> | null = null;
  try {
    token = Notifications.addPushTokenListener(() => {
      void registerForPushIfPermitted();
    });
  } catch {
    // Some runtimes (for example Expo Go on Android) cannot observe token rollover.
  }

  return () => {
    received.remove();
    response.remove();
    token?.remove();
  };
}
