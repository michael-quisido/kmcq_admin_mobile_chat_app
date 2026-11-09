import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));
jest.mock("../push", () => ({ registerForPushIfPermitted: jest.fn() }));

import { router } from "expo-router";
import { registerForPushIfPermitted } from "../push";
import { consumePendingConversationId, setPendingConversationId } from "../pendingConversation";
import { routeAfterAuthentication } from "../authRouting";

const replace = jest.mocked(router.replace);
const register = jest.mocked(registerForPushIfPermitted);

beforeEach(() => {
  jest.clearAllMocks();
  consumePendingConversationId();
  register.mockResolvedValue(null);
});

describe("routeAfterAuthentication", () => {
  it("routes to the livechat list when nothing is pending", () => {
    routeAfterAuthentication();

    expect(replace).toHaveBeenCalledWith("/livechat");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("consumes a pending conversation and routes to it", () => {
    setPendingConversationId(42);

    routeAfterAuthentication();

    expect(replace).toHaveBeenCalledWith({
      pathname: "/livechat",
      params: { conversationId: "42" },
    });
    expect(consumePendingConversationId()).toBeNull();
  });

  it("still routes when push registration rejects", async () => {
    register.mockRejectedValueOnce(new Error("offline"));

    routeAfterAuthentication();
    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/livechat");
  });
});
