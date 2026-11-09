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
  void configureNotifications();

  const lastResponse = Notifications.getLastNotificationResponse();
  if (lastResponse) {
    handleNotificationResponse(lastResponse, false);
    Notifications.clearLastNotificationResponse();
  }

  const received = Notifications.addNotificationReceivedListener(handleNotificationReceived);
  const response = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
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
