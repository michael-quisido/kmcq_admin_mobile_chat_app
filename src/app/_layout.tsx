import { useEffect } from "react";
import { Stack } from "expo-router";
import { initialiseNotifications } from "../lib/notifications/setup";

export default function RootLayout() {
  useEffect(() => initialiseNotifications(), []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="livechat" />
      <Stack.Screen name="agents" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="account-settings" />
      <Stack.Screen name="notification-sound" />
    </Stack>
  );
}
