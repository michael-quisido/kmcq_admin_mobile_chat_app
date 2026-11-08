import { isSoundsEnabled } from "./preferences";
import { playAlertSound } from "./playAlertSound";

export type NewMessage = {
  conversationId: number;
  messageId: number;
  sender?: string | null;
  muted?: boolean;
};

const MAX_TRACKED_CONVERSATIONS = 500;
const watermarks = new Map<number, number>();

function validId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function trimWatermarks(): void {
  while (watermarks.size > MAX_TRACKED_CONVERSATIONS) {
    const oldest = watermarks.keys().next().value;
    if (oldest === undefined) return;
    watermarks.delete(oldest);
  }
}

function updateWatermark(conversationId: number, messageId: number): void {
  watermarks.delete(conversationId);
  watermarks.set(conversationId, messageId);
  trimWatermarks();
}

export function seedConversation(conversationId: number, messageId: number): void {
  if (!validId(conversationId) || !validId(messageId)) return;
  const current = watermarks.get(conversationId) ?? 0;
  if (messageId <= current) return;
  updateWatermark(conversationId, messageId);
}

export function notifyNewMessage(message: NewMessage): void {
  const { conversationId, messageId } = message;
  if (!validId(conversationId) || !validId(messageId)) return;

  const current = watermarks.get(conversationId) ?? 0;
  if (messageId <= current) return;

  updateWatermark(conversationId, messageId);

  if (message.sender === "agent") return;
  if (message.muted) return;
  if (!isSoundsEnabled()) return;

  void playAlertSound().catch(() => {});
}

export function resetAlertCoordinator(): void {
  watermarks.clear();
}
