import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import {
  configureNotifications,
  handleLivechatDeepLink,
  handleNotificationReceived,
  handleNotificationResponse,
  registerForPushIfPermitted,
} from "./push";
import { loadSoundsEnabled } from "./preferences";

export function initialiseNotifications(): () => void {
  void loadSoundsEnabled();
  configureNotifications().catch(() => {});

  let cancelled = false;

  try {
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) {
      handleNotificationResponse(lastResponse, false);
      Notifications.clearLastNotificationResponse();
    }
  } catch {
    // Some runtimes cannot read the last notification response.
  }

  const handleInitialUrl = async () => {
    try {
      const url = await Linking.getInitialURL();
      if (!cancelled && url) {
        handleLivechatDeepLink(url, false);
      }
    } catch {
      // Some runtimes cannot read the launch URL.
    }
  };
  void handleInitialUrl();

  const received = Notifications.addNotificationReceivedListener(handleNotificationReceived);
  const response = Notifications.addNotificationResponseReceivedListener((notificationResponse) => {
    handleNotificationResponse(notificationResponse);
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // Clearing the last response is best effort.
    }
  });
  let url: ReturnType<typeof Linking.addEventListener> | null = null;
  try {
    url = Linking.addEventListener("url", ({ url: openedUrl }) => {
      handleLivechatDeepLink(openedUrl);
    });
  } catch {
    // Some runtimes cannot observe incoming deep links.
  }
  let token: ReturnType<typeof Notifications.addPushTokenListener> | null = null;
  try {
    token = Notifications.addPushTokenListener(() => {
      void registerForPushIfPermitted();
    });
  } catch {
    // Some runtimes (for example Expo Go on Android) cannot observe token rollover.
  }

  return () => {
    cancelled = true;
    received.remove();
    response.remove();
    url?.remove();
    token?.remove();
  };
}
