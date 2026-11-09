import { useEffect } from "react";
import { router } from "expo-router";
import api from "../lib/api";
import { View, ActivityIndicator } from "react-native";
import { registerForPushIfPermitted } from "../lib/notifications/push";
import { consumePendingConversationId } from "../lib/notifications/pendingConversation";

export default function Index() {
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      await api.get("/api/mobile/livechat/auth/me");
    } catch {
      router.replace("/login");
      return;
    }

    void registerForPushIfPermitted().catch(() => {});

    const pending = consumePendingConversationId();
    if (pending) {
      router.replace({ pathname: "/livechat", params: { conversationId: String(pending) } });
    } else {
      router.replace("/livechat");
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#040f2d" }}>
      <ActivityIndicator size="large" color="#27a343" />
    </View>
  );
}
