import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: jest.fn(),
}));

import { requireOptionalNativeModule } from "expo-modules-core";
import {
  clearAllLivechatBubbles,
  clearLivechatConversationBubble,
  ensureLivechatNotificationChannel,
} from "../livechatBubbles";

const requireModule = jest.mocked(requireOptionalNativeModule);

beforeEach(() => {
  jest.clearAllMocks();
  requireModule.mockReturnValue(null);
});

describe("livechat bubble cleanup", () => {
  it("creates or repairs the notification channel through the native module", async () => {
    const ensureChannels = jest.fn(async () => undefined);
    requireModule.mockReturnValue({ ensureChannels, clearConversation: jest.fn(), clearAll: jest.fn() } as never);

    await ensureLivechatNotificationChannel();

    expect(requireModule).toHaveBeenCalledWith("LivechatBubbles");
    expect(ensureChannels).toHaveBeenCalledTimes(1);
  });

  it("clears one conversation through the native module", async () => {
    const clearConversation = jest.fn(async (_conversationId: number) => undefined);
    requireModule.mockReturnValue({ clearConversation, clearAll: jest.fn() } as never);

    await clearLivechatConversationBubble(42);

    expect(requireModule).toHaveBeenCalledWith("LivechatBubbles");
    expect(clearConversation).toHaveBeenCalledWith(42);
  });

  it("clears every conversation through the native module", async () => {
    const clearAll = jest.fn(async () => undefined);
    requireModule.mockReturnValue({ clearConversation: jest.fn(), clearAll } as never);

    await clearAllLivechatBubbles();

    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid conversation IDs", async () => {
    const clearConversation = jest.fn(async () => undefined);
    requireModule.mockReturnValue({ clearConversation, clearAll: jest.fn() } as never);

    await clearLivechatConversationBubble(0);
    await clearLivechatConversationBubble(Number.NaN);

    expect(clearConversation).not.toHaveBeenCalled();
  });

  it("is a no-op when the native module is unavailable", async () => {
    await expect(ensureLivechatNotificationChannel()).resolves.toBeUndefined();
    await expect(clearLivechatConversationBubble(42)).resolves.toBeUndefined();
    await expect(clearAllLivechatBubbles()).resolves.toBeUndefined();
  });

  it("never lets native cleanup failures break logout", async () => {
    const clearAll = jest.fn(async () => {
      throw new Error("native unavailable");
    });
    requireModule.mockReturnValue({ clearConversation: jest.fn(), clearAll } as never);

    await expect(clearAllLivechatBubbles()).resolves.toBeUndefined();
  });
});
