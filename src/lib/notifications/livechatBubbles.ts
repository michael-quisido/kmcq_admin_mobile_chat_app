import { requireOptionalNativeModule } from "expo-modules-core";

type LivechatBubblesNativeModule = {
  ensureChannels(): Promise<void>;
  clearConversation(conversationId: number): Promise<void>;
  clearAll(): Promise<void>;
};

function nativeModule(): LivechatBubblesNativeModule | null {
  try {
    return requireOptionalNativeModule<LivechatBubblesNativeModule>("LivechatBubbles");
  } catch {
    return null;
  }
}

export async function ensureLivechatNotificationChannel(): Promise<void> {
  try {
    await nativeModule()?.ensureChannels();
  } catch {
    // Falls back to the channel created by expo-notifications.
  }
}

export async function clearLivechatConversationBubble(conversationId: number): Promise<void> {
  if (!Number.isInteger(conversationId) || conversationId <= 0) return;

  try {
    await nativeModule()?.clearConversation(conversationId);
  } catch {
    // Native cleanup must never block the app.
  }
}

export async function clearAllLivechatBubbles(): Promise<void> {
  try {
    await nativeModule()?.clearAll();
  } catch {
    // Native cleanup must never block logout.
  }
}
