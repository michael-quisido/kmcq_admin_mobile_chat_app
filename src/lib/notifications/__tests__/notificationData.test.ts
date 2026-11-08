import { describe, expect, it } from "@jest/globals";
import { parseLivechatMessageData, parseTestNotificationData } from "../notificationData";

describe("parseLivechatMessageData", () => {
  it("accepts valid positive integer IDs", () => {
    expect(
      parseLivechatMessageData({ type: "livechat_message", conversationId: 42, messageId: 1001 }),
    ).toEqual({ conversationId: 42, messageId: 1001 });
  });

  it("rejects a different notification type", () => {
    expect(parseLivechatMessageData({ type: "test", conversationId: 42, messageId: 1001 })).toBeNull();
  });

  it("rejects missing, string, zero, negative, and non-integer IDs", () => {
    expect(parseLivechatMessageData({ type: "livechat_message", messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: "42", messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: 0, messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: -1, messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: 1.5, messageId: 1 })).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseLivechatMessageData(null)).toBeNull();
    expect(parseLivechatMessageData(undefined)).toBeNull();
    expect(parseLivechatMessageData("livechat_message")).toBeNull();
  });
});

describe("parseTestNotificationData", () => {
  it("accepts the test type", () => {
    expect(parseTestNotificationData({ type: "test" })).toBe(true);
  });

  it("rejects other and missing types", () => {
    expect(parseTestNotificationData({ type: "livechat_message" })).toBe(false);
    expect(parseTestNotificationData({})).toBe(false);
    expect(parseTestNotificationData(null)).toBe(false);
  });
});
