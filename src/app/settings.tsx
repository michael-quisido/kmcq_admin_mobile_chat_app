import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import api from "../lib/api";

export default function SettingsScreen() {
  const [adminEmail, setAdminEmail] = useState("");
  const [retentionDays, setRetentionDays] = useState("30");
  const [staleMinutes, setStaleMinutes] = useState("10");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [savedTelegramChatId, setSavedTelegramChatId] = useState("");
  const [telegramConfigured, setTelegramConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const chatIdUnsaved = telegramChatId.trim() !== savedTelegramChatId.trim();
  const canTest = !testing && !chatIdUnsaved && savedTelegramChatId !== "" && telegramConfigured;

  const fetchSettings = async () => {
    try {
      const response = await api.get("/api/mobile/livechat/settings");
      const data = response.data;
      setAdminEmail(data.adminEmail || "");
      setRetentionDays(String(data.retentionDays || 30));
      setStaleMinutes(String(data.staleMinutes || 10));
      setTelegramChatId(data.telegramChatId || "");
      setSavedTelegramChatId(data.telegramChatId || "");
      setTelegramConfigured(data.telegramConfigured ?? true);
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to fetch settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const response = await api.put("/api/mobile/livechat/settings", {
        adminEmail,
        retentionDays,
        staleMinutes,
        telegramChatId,
      });
      setSavedTelegramChatId(response.data.telegramChatId || "");
      setTelegramConfigured(response.data.telegramConfigured ?? true);
      Alert.alert("Success", "Settings saved successfully");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const sendTestMessage = async () => {
    setTesting(true);
    try {
      const response = await api.post("/api/mobile/livechat/settings/test-telegram");
      Alert.alert("Success", "Test message sent. Check the chat.");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Couldn't send the test message.");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>LiveChat Settings</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.section}>
          <Text style={styles.label}>Admin alert email</Text>
          <TextInput
            style={styles.input}
            value={adminEmail}
            onChangeText={setAdminEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Retention days</Text>
          <TextInput
            style={styles.input}
            value={retentionDays}
            onChangeText={setRetentionDays}
            placeholder="30"
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Stale after (minutes)</Text>
          <TextInput
            style={styles.input}
            value={staleMinutes}
            onChangeText={setStaleMinutes}
            placeholder="10"
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Telegram chat ID</Text>
          <TextInput
            style={styles.input}
            value={telegramChatId}
            onChangeText={setTelegramChatId}
            placeholder="Chat ID"
            keyboardType="number-pad"
          />

          <TouchableOpacity
            style={[styles.testButton, !canTest && styles.buttonDisabled]}
            onPress={sendTestMessage}
            disabled={!canTest}
          >
            <Text style={styles.testButtonText}>{testing ? "Sending..." : "Send test message"}</Text>
          </TouchableOpacity>
          {chatIdUnsaved && <Text style={styles.hint}>Testing uses the chat ID the server has saved. Save your change first.</Text>}
          {!chatIdUnsaved && savedTelegramChatId === "" && <Text style={styles.hint}>Set a chat ID and save it before testing.</Text>}
          {!chatIdUnsaved && savedTelegramChatId !== "" && !telegramConfigured && (
            <Text style={styles.hint}>Set LIVE_CHAT_TELEGRAM_BOT_TOKEN on the server, then restart the app, before testing.</Text>
          )}

          <TouchableOpacity style={styles.saveButton} onPress={save} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? "Saving..." : "Save"}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    backgroundColor: "#040f2d",
  },
  headerButton: {
    minWidth: 60,
    alignItems: "center",
  },
  backText: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  headerTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  scrollContainer: {
    padding: 10,
  },
  section: {
    backgroundColor: "white",
    padding: 15,
    borderRadius: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  testButton: {
    backgroundColor: "#f0f0f0",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  testButtonText: {
    fontSize: 14,
    color: "#333",
  },
  hint: {
    fontSize: 12,
    color: "#666",
    marginTop: 5,
    fontStyle: "italic",
  },
  saveButton: {
    backgroundColor: "#040f2d",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 20,
  },
  saveButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
