import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="livechat" />
      <Stack.Screen name="agents" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}
