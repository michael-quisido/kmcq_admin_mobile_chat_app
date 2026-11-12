import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: "test-project-id" } } },
    easConfig: null,
  },
}));
let mockIsDevice = true;
jest.mock("expo-device", () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));
jest.mock("expo-notifications", () => ({
  PermissionStatus: { GRANTED: "granted" },
  AndroidImportance: { HIGH: 6 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addPushTokenListener: jest.fn(),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../alertCoordinator", () => ({ notifyNewMessage: jest.fn() }));
jest.mock("../livechatBubbles", () => ({
  clearAllLivechatBubbles: jest.fn(async () => undefined),
  clearLivechatConversationBubble: jest.fn(async () => undefined),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("../../api", () => ({ __esModule: true, default: { post: jest.fn() } }));

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import api from "../../api";
import { notifyNewMessage } from "../alertCoordinator";
import { clearAllLivechatBubbles } from "../livechatBubbles";
import { consumePendingConversationId } from "../pendingConversation";
import {
  configureNotifications,
  getNotificationPermission,
  handleLivechatDeepLink,
  handleNotificationReceived,
  handleNotificationResponse,
  registerForPushIfPermitted,
  registerForPushNotifications,
  requestNotificationPermission,
  sendTestMobilePush,
  unregisterForPushNotifications,
} from "../push";

const getPermissions = jest.mocked(Notifications.getPermissionsAsync);
const requestPermissions = jest.mocked(Notifications.requestPermissionsAsync);
const getToken = jest.mocked(Notifications.getExpoPushTokenAsync);
const setHandler = jest.mocked(Notifications.setNotificationHandler);
const setChannel = jest.mocked(Notifications.setNotificationChannelAsync);
const setItem = jest.mocked(SecureStore.setItemAsync);
const getItem = jest.mocked(SecureStore.getItemAsync);
const deleteItem = jest.mocked(SecureStore.deleteItemAsync);
const post = jest.mocked(api.post);
const push = jest.mocked(router.push);
const alert = jest.mocked(notifyNewMessage);
const clearBubbles = jest.mocked(clearAllLivechatBubbles);
const constants = Constants as unknown as { expoConfig: unknown; easConfig: unknown };

beforeEach(() => {
  jest.clearAllMocks();
  consumePendingConversationId();
  constants.expoConfig = { extra: { eas: { projectId: "test-project-id" } } };
  constants.easConfig = null;
  mockIsDevice = true;
  getPermissions.mockResolvedValue({ granted: true, status: "granted" } as never);
  requestPermissions.mockResolvedValue({ granted: true, status: "granted" } as never);
  getToken.mockResolvedValue({ data: "ExponentPushToken[unit]" } as never);
  post.mockResolvedValue({ data: { ok: true } } as never);
});

describe("notification permission", () => {
  it("reports an existing grant without prompting", async () => {
    await expect(getNotificationPermission()).resolves.toBe("granted");
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("reports denied when the OS will not ask again", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "denied",
      canAskAgain: false,
    } as never);
    await expect(getNotificationPermission()).resolves.toBe("denied");
  });

  it("requests permission and returns the result", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "undetermined",
      canAskAgain: true,
    } as never);
    requestPermissions.mockResolvedValueOnce({
      granted: true,
      status: "granted",
      canAskAgain: true,
    } as never);
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });
});

describe("registerForPushNotifications", () => {
  it("returns null on a simulator without prompting or requesting a token", async () => {
    mockIsDevice = false;
    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(getPermissions).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("returns null when permission is denied", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "denied",
      canAskAgain: false,
    } as never);
    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("registers the token with the server", async () => {
    await expect(registerForPushNotifications()).resolves.toBe("ExponentPushToken[unit]");
    expect(getToken).toHaveBeenCalledWith({ projectId: "test-project-id" });
    expect(post).toHaveBeenCalledWith("/api/mobile/livechat/push/register", {
      token: "ExponentPushToken[unit]",
      platform: "ios",
    });
    expect(setItem).toHaveBeenCalledWith("kmcq_expo_push_token", "ExponentPushToken[unit]");
  });

  it("returns null if server registration fails", async () => {
    post.mockRejectedValueOnce(new Error("offline"));
    await expect(registerForPushNotifications()).resolves.toBeNull();
  });

  it("returns null when the EAS project ID is missing", async () => {
    constants.expoConfig = { extra: {} };
    constants.easConfig = null;
    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("registerForPushIfPermitted", () => {
  it("never prompts when permission was already denied", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "denied",
      canAskAgain: false,
    } as never);
    await expect(registerForPushIfPermitted()).resolves.toBeNull();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("registers silently when permission is already granted", async () => {
    await expect(registerForPushIfPermitted()).resolves.toBe("ExponentPushToken[unit]");
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledTimes(1);
  });
});

describe("unregisterForPushNotifications", () => {
  it("posts the token and swallows failures", async () => {
    await unregisterForPushNotifications("ExponentPushToken[unit]");
    expect(post).toHaveBeenCalledWith("/api/mobile/livechat/push/unregister", {
      token: "ExponentPushToken[unit]",
    });
    post.mockRejectedValueOnce(new Error("offline"));
    await expect(unregisterForPushNotifications("ExponentPushToken[unit]")).resolves.toBeUndefined();
    expect(clearBubbles).toHaveBeenCalledTimes(2);
  });

  it("uses the stored token when none is passed", async () => {
    getItem.mockResolvedValueOnce("ExponentPushToken[stored]" as never);

    await unregisterForPushNotifications();

    expect(getItem).toHaveBeenCalledWith("kmcq_expo_push_token");
    expect(post).toHaveBeenCalledWith("/api/mobile/livechat/push/unregister", {
      token: "ExponentPushToken[stored]",
    });
    expect(deleteItem).toHaveBeenCalledWith("kmcq_expo_push_token");
    expect(clearBubbles).toHaveBeenCalledTimes(1);
  });

  it("clears local bubbles even when no token is stored", async () => {
    await unregisterForPushNotifications();

    expect(post).not.toHaveBeenCalled();
    expect(clearBubbles).toHaveBeenCalledTimes(1);
  });
});

describe("sendTestMobilePush", () => {
  it("returns the server result", async () => {
    post.mockResolvedValueOnce({ data: { sent: 1, failed: 0, tokens: 1 } } as never);
    await expect(sendTestMobilePush()).resolves.toEqual({ sent: 1, failed: 0, tokens: 1 });
  });
});

describe("configureNotifications", () => {
  it("suppresses real messages in the foreground and shows tests", async () => {
    await configureNotifications();
    expect(setHandler).toHaveBeenCalledTimes(1);
    const handler = setHandler.mock.calls[0][0] as {
      handleNotification: (notification: unknown) => Promise<{
        shouldShowBanner: boolean;
        shouldShowList: boolean;
        shouldPlaySound: boolean;
        shouldSetBadge: boolean;
      }>;
    };

    const livechat = {
      request: { content: { data: { type: "livechat_message", conversationId: 42, messageId: 99 } } },
    };
    await expect(handler.handleNotification(livechat)).resolves.toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });

    const test = { request: { content: { data: { type: "test" } } } };
    await expect(handler.handleNotification(test)).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it("configures the Android livechat channel with the doorbell sound", async () => {
    const platform = jest.replaceProperty(Platform, "OS", "android");
    try {
      await configureNotifications();
    } finally {
      platform.restore();
    }

    expect(setChannel).toHaveBeenCalledWith(
      "livechat",
      expect.objectContaining({
        sound: "kmcq_gmbh_doorbell.wav",
        importance: 6,
      }),
    );
    expect(Platform.OS).toBe("ios");
  });
});

describe("handleNotificationResponse", () => {
  it("stores the conversation and routes to it on a live tap", () => {
    handleNotificationResponse({
      notification: {
        request: {
          content: {
            data: { type: "livechat_message", conversationId: 42, messageId: 99 },
          },
        },
      },
    } as never);

    expect(consumePendingConversationId()).toBe(42);
    expect(push).toHaveBeenCalledWith({
      pathname: "/livechat",
      params: { conversationId: "42" },
    });
  });

  it("ignores malformed and unrelated data", () => {
    handleNotificationResponse({
      notification: { request: { content: { data: { type: "livechat_message", conversationId: "42" } } } },
    } as never);
    handleNotificationResponse(null);

    expect(consumePendingConversationId()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("routes a test notification to the notification sound screen", () => {
    handleNotificationResponse({
      notification: { request: { content: { data: { type: "test" } } } },
    } as never);

    expect(push).toHaveBeenCalledWith("/notification-sound");
    expect(consumePendingConversationId()).toBeNull();
  });

  it("stores a livechat conversation without navigating when navigate is false", () => {
    handleNotificationResponse(
      {
        notification: {
          request: {
            content: {
              data: { type: "livechat_message", conversationId: 42, messageId: 99 },
            },
          },
        },
      } as never,
      false,
    );

    expect(consumePendingConversationId()).toBe(42);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("handleNotificationReceived", () => {
  it("forwards a valid foreground message to the coordinator", () => {
    handleNotificationReceived({
      request: { content: { data: { type: "livechat_message", conversationId: 42, messageId: 99 } } },
    } as never);

    expect(alert).toHaveBeenCalledWith({
      conversationId: 42,
      messageId: 99,
      sender: "visitor",
      muted: false,
    });
  });
});

describe("handleLivechatDeepLink", () => {
  it("stores and routes to a conversation from a bubble link", () => {
    handleLivechatDeepLink("kmcqadminmobilechatapp://livechat?conversationId=42");

    expect(consumePendingConversationId()).toBe(42);
    expect(push).toHaveBeenCalledWith({
      pathname: "/livechat",
      params: { conversationId: "42" },
    });
  });

  it("stores without navigating during cold start", () => {
    handleLivechatDeepLink("kmcqadminmobilechatapp://livechat?conversationId=42", false);

    expect(consumePendingConversationId()).toBe(42);
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores unrelated URLs", () => {
    handleLivechatDeepLink("kmcqadminmobilechatapp://settings");
    handleLivechatDeepLink(null);

    expect(consumePendingConversationId()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
