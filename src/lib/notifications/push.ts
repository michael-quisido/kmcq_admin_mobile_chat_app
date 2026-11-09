import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import api from "../api";
import { notifyNewMessage } from "./alertCoordinator";
import { parseLivechatMessageData, parseTestNotificationData } from "./notificationData";
import { setPendingConversationId } from "./pendingConversation";
import type { NotificationPermission, PushTestResult } from "./push.types";

const PUSH_TOKEN_KEY = "kmcq_expo_push_token";
const CHANNEL_ID = "livechat";

function getProjectId(): string | null {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export async function configureNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isTest = parseTestNotificationData(notification.request.content.data);
      return {
        shouldShowBanner: isTest,
        shouldShowList: isTest,
        shouldPlaySound: isTest,
        shouldSetBadge: false,
      };
    },
  });

  if (Platform.OS !== "android") return;

  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "LiveChat messages",
      importance: AndroidImportance.HIGH,
      sound: "kmcq_gmbh_doorbell.wav",
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      lightColor: "#27a343",
    });
  } catch {
    // The channel may already exist; it still uses the configured sound.
  }
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.granted) return "granted";
    return permissions.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    if (!current.canAskAgain) return "denied";

    const asked = await Notifications.requestPermissionsAsync();
    if (asked.granted) return "granted";
    return asked.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

async function registerDeviceToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;

    const projectId = getProjectId();
    if (!projectId) return null;

    const token = await Notifications.getExpoPushTokenAsync({ projectId });

    try {
      await api.post("/api/mobile/livechat/push/register", {
        token: token.data,
        platform: Platform.OS === "android" ? "android" : "ios",
      });
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token.data);
    } catch {
      return null;
    }

    return token.data;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if ((await requestNotificationPermission()) !== "granted") return null;
  return registerDeviceToken();
}

export async function registerForPushIfPermitted(): Promise<string | null> {
  if ((await getNotificationPermission()) !== "granted") return null;
  return registerDeviceToken();
}

export async function unregisterForPushNotifications(explicitToken?: string): Promise<void> {
  try {
    const token = explicitToken ?? (await SecureStore.getItemAsync(PUSH_TOKEN_KEY));
    if (!token) return;

    try {
      await api.post("/api/mobile/livechat/push/unregister", { token });
    } catch {
      // Best effort. The server prunes tokens Expo reports as unregistered.
    }
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  } catch {
    // Never block logout on push cleanup.
  }
}

export async function sendTestMobilePush(): Promise<PushTestResult> {
  const res = await api.post<PushTestResult>("/api/mobile/livechat/push/test");
  return res.data;
}

export function handleNotificationReceived(notification: Notifications.Notification): void {
  const livechat = parseLivechatMessageData(notification.request.content.data);
  if (!livechat) return;

  notifyNewMessage({
    conversationId: livechat.conversationId,
    messageId: livechat.messageId,
    sender: "visitor",
    muted: false,
  });
}

export function handleNotificationResponse(
  response: Notifications.NotificationResponse | null,
  navigate = true,
): void {
  if (!response) return;

  const data = response.notification.request.content.data;
  const livechat = parseLivechatMessageData(data);
  if (livechat) {
    setPendingConversationId(livechat.conversationId);
    if (navigate) {
      router.push({
        pathname: "/livechat",
        params: { conversationId: String(livechat.conversationId) },
      });
    }
    return;
  }

  if (navigate && parseTestNotificationData(data)) {
    router.push("/notification-sound");
  }
}
