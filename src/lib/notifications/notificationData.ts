export type LivechatNotificationData = {
  conversationId: number;
  messageId: number;
  senderName?: string;
};

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveIntegerString(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

export function parseLivechatMessageData(data: unknown): LivechatNotificationData | null {
  const record = asRecord(data);
  if (!record || record.type !== "livechat_message") return null;

  const conversationId = positiveInteger(record.conversationId);
  const messageId = positiveInteger(record.messageId);
  if (conversationId === null || messageId === null) return null;

  const senderName =
    typeof record.senderName === "string" ? record.senderName.trim() : "";
  if (!senderName) return { conversationId, messageId };

  return { conversationId, messageId, senderName };
}

export function parseLivechatDeepLink(url: string | null): number | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "kmcqadminmobilechatapp:") return null;
    if (parsed.hostname !== "livechat") return null;
    return positiveIntegerString(parsed.searchParams.get("conversationId"));
  } catch {
    return null;
  }
}

export function parseTestNotificationData(data: unknown): boolean {
  const record = asRecord(data);
  return record?.type === "test";
}
