import { describe, expect, it, jest } from "@jest/globals";
import { Conversation, fetchConversations } from "../conversations";

const conversation: Conversation = {
  id: 42,
  visitorName: "Test Visitor",
  visitorEmail: "visitor@example.com",
  lastMessagePreview: "Hello",
  lastMessageId: 7,
  lastMessageSender: "visitor",
  unreadCount: 1,
  status: "open",
  muted: false,
};

type Get = (url: string) => Promise<{ data: unknown }>;

function clientWith(data: unknown) {
  return { get: jest.fn<Get>().mockResolvedValue({ data }) };
}

function failingClient(status?: number) {
  return {
    get: jest.fn<Get>().mockRejectedValue(
      status === undefined ? new Error("network unavailable") : { response: { status } },
    ),
  };
}

describe("fetchConversations", () => {
  it("loads conversations for the authenticated session", async () => {
    const client = clientWith([conversation]);

    await expect(fetchConversations(client)).resolves.toEqual({
      status: "success",
      conversations: [conversation],
    });
    expect(client.get).toHaveBeenCalledWith("/api/mobile/livechat/conversations");
  });

  it("does not send a client-supplied user identity with the request", async () => {
    const client = clientWith([conversation]);

    await fetchConversations(client);

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get.mock.calls[0]).toHaveLength(1);
    expect(client.get.mock.calls[0][0]).not.toMatch(/userId|adminId|user_id|admin_id/);
  });

  it("returns a genuine empty result without treating it as an error", async () => {
    const client = clientWith([]);

    await expect(fetchConversations(client)).resolves.toEqual({
      status: "success",
      conversations: [],
    });
  });

  it("returns an error when the request fails", async () => {
    await expect(fetchConversations(failingClient(500))).resolves.toEqual({
      status: "error",
    });
    await expect(fetchConversations(failingClient())).resolves.toEqual({
      status: "error",
    });
  });

  it("returns an error when the response payload is not a list", async () => {
    await expect(fetchConversations(clientWith({ conversations: [] }))).resolves.toEqual({
      status: "error",
    });
  });

  it("returns unauthorized separately from other failures", async () => {
    await expect(fetchConversations(failingClient(401))).resolves.toEqual({
      status: "unauthorized",
    });
    await expect(fetchConversations(failingClient(403))).resolves.toEqual({
      status: "unauthorized",
    });
  });
});
