import { api } from "../api";

export interface Conversation {
  id: number;
  visitorName: string;
  visitorEmail: string;
  lastMessagePreview?: string;
  lastMessageId?: number | null;
  lastMessageSender?: string | null;
  unreadCount?: number;
  status?: string;
  muted?: boolean;
}

export type ConversationFetchResult =
  | { status: "success"; conversations: Conversation[] }
  | { status: "unauthorized" }
  | { status: "error" };

type ConversationClient = {
  get(url: string): Promise<{ data: unknown }>;
};

export async function fetchConversations(
  client: ConversationClient = api,
): Promise<ConversationFetchResult> {
  try {
    const response = await client.get("/api/mobile/livechat/conversations");
    if (!Array.isArray(response.data)) {
      return { status: "error" };
    }

    return {
      status: "success",
      conversations: response.data as Conversation[],
    };
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 401 || status === 403) {
      return { status: "unauthorized" };
    }

    return { status: "error" };
  }
}
