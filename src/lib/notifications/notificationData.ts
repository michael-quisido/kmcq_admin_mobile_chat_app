export type LivechatNotificationData = {
  conversationId: number;
  messageId: number;
};

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
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

  return { conversationId, messageId };
}

export function parseTestNotificationData(data: unknown): boolean {
  const record = asRecord(data);
  return record?.type === "test";
}
