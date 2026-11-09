import { router } from "expo-router";
import { registerForPushIfPermitted } from "./push";
import { consumePendingConversationId } from "./pendingConversation";

export function routeAfterAuthentication(): void {
  void registerForPushIfPermitted().catch(() => {});

  const pending = consumePendingConversationId();
  if (pending) {
    router.replace({ pathname: "/livechat", params: { conversationId: String(pending) } });
  } else {
    router.replace("/livechat");
  }
}
