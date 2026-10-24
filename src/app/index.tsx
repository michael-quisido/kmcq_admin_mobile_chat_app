import { useEffect } from "react";
import { router } from "expo-router";
import api from "../lib/api";
import { View, ActivityIndicator } from "react-native";

export default function Index() {
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      await api.get("/api/mobile/livechat/auth/me");
      router.replace("/livechat");
    } catch {
      router.replace("/login");
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#040f2d" }}>
      <ActivityIndicator size="large" color="#27a343" />
    </View>
  );
}
