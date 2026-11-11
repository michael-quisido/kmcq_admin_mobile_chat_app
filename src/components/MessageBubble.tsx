import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Notifications from "expo-notifications";

export function MessageBubble() {
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      const title = typeof content.title === "string" ? content.title.slice(0, 80) : "";
      const body = typeof content.body === "string" ? content.body.slice(0, 180) : "";

      if (!title && !body) return;
      setMessage({ title, body });
    });

    return () => subscription.remove();
  }, []);

  if (!message) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: 60, left: 16, right: 16, zIndex: 999 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss message notification"
        onPress={() => setMessage(null)}
        style={{ backgroundColor: "#222", padding: 14, borderRadius: 14, elevation: 6 }}
      >
        {!!message.title && (
          <Text style={{ color: "white", fontWeight: "700" }}>{message.title}</Text>
        )}
        {!!message.body && (
          <Text style={{ color: "white", marginTop: 4 }}>{message.body}</Text>
        )}
        <Text style={{ color: "#ccc", marginTop: 8 }}>Tap to dismiss</Text>
      </Pressable>
    </View>
  );
}
