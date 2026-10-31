import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import api from "../lib/api";

export default function AccountSettingsScreen() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Email change
  const [currentPasswordEmail, setCurrentPasswordEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStep, setEmailStep] = useState<"form" | "code">("form");
  const [emailLoading, setEmailLoading] = useState(false);
  
  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [passwordCode, setPasswordCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStep, setPasswordStep] = useState<"form" | "code">("form");
  const [passwordLoading, setPasswordLoading] = useState(false);
  
  // Username change
  const [username, setUsername] = useState("");
  const [currentPasswordUsername, setCurrentPasswordUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const res = await api.get("/api/mobile/livechat/auth/me");
      setUser(res.data.user);
      setUsername(res.data.user.username);
    } catch (error: any) {
      Alert.alert("Error", "Failed to fetch user");
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const requestEmailChange = async () => {
    if (!currentPasswordEmail || !newEmail) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    setEmailLoading(true);
    try {
      await api.post("/api/mobile/livechat/auth/request-email-change", {
        currentPassword: currentPasswordEmail,
        newEmail,
      });
      setEmailStep("code");
      Alert.alert("Success", "Verification code sent to new email");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to request email change");
    } finally {
      setEmailLoading(false);
    }
  };

  const verifyEmailChange = async () => {
    if (!emailCode) {
      Alert.alert("Error", "Please enter the verification code");
      return;
    }
    setEmailLoading(true);
    try {
      const res = await api.post("/api/mobile/livechat/auth/verify-email-change", { code: emailCode });
      setUser({ ...user, email: res.data.email });
      setEmailStep("form");
      setCurrentPasswordEmail("");
      setNewEmail("");
      setEmailCode("");
      Alert.alert("Success", "Email updated successfully");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to verify email change");
    } finally {
      setEmailLoading(false);
    }
  };

  const requestPasswordChange = async () => {
    if (!currentPassword) {
      Alert.alert("Error", "Please enter current password");
      return;
    }
    setPasswordLoading(true);
    try {
      await api.post("/api/mobile/livechat/auth/request-password-change", {
        currentPassword,
      });
      setPasswordStep("code");
      Alert.alert("Success", "Verification code sent");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to request password change");
    } finally {
      setPasswordLoading(false);
    }
  };

  const verifyPasswordChange = async () => {
    if (!passwordCode || !newPassword || !confirmPassword) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    setPasswordLoading(true);
    try {
      await api.post("/api/mobile/livechat/auth/verify-password-change", {
        code: passwordCode,
        newPassword,
      });
      setPasswordStep("form");
      setCurrentPassword("");
      setPasswordCode("");
      setNewPassword("");
      setConfirmPassword("");
      Alert.alert("Success", "Password updated successfully");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to verify password change");
    } finally {
      setPasswordLoading(false);
    }
  };

  const updateUsername = async () => {
    if (!username || !currentPasswordUsername) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    if (username.length < 3) {
      Alert.alert("Error", "Username must be at least 3 characters");
      return;
    }
    setUsernameLoading(true);
    try {
      const res = await api.put("/api/mobile/livechat/auth/update-username", {
        username,
        currentPassword: currentPasswordUsername,
      });
      setUser({ ...user, username: res.data.username });
      setCurrentPasswordUsername("");
      Alert.alert("Success", "Username updated successfully");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to update username");
    } finally {
      setUsernameLoading(false);
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
        <Text style={styles.headerTitle}>Account Settings</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Information</Text>
          <Text style={styles.infoText}>Email: {user?.email}</Text>
          <Text style={styles.infoText}>Username: {user?.username}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="New username"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={currentPasswordUsername}
            onChangeText={setCurrentPasswordUsername}
            placeholder="Current password"
            secureTextEntry
          />
          <TouchableOpacity style={styles.button} onPress={updateUsername} disabled={usernameLoading}>
            <Text style={styles.buttonText}>{usernameLoading ? "Updating..." : "Update Username"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change Email</Text>
          {emailStep === "form" ? (
            <>
              <TextInput
                style={styles.input}
                value={currentPasswordEmail}
                onChangeText={setCurrentPasswordEmail}
                placeholder="Current password"
                secureTextEntry
              />
              <TextInput
                style={styles.input}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="New email"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.button} onPress={requestEmailChange} disabled={emailLoading}>
                <Text style={styles.buttonText}>{emailLoading ? "Sending..." : "Send Verification Code"}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.hint}>Verification code sent to {newEmail}</Text>
              <TextInput
                style={styles.input}
                value={emailCode}
                onChangeText={setEmailCode}
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
              />
              <TouchableOpacity style={styles.button} onPress={verifyEmailChange} disabled={emailLoading}>
                <Text style={styles.buttonText}>{emailLoading ? "Verifying..." : "Verify & Update Email"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkButton} onPress={() => setEmailStep("form")}>
                <Text style={styles.linkText}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change Password</Text>
          {passwordStep === "form" ? (
            <>
              <TextInput
                style={styles.input}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="Current password"
                secureTextEntry
              />
              <TouchableOpacity style={styles.button} onPress={requestPasswordChange} disabled={passwordLoading}>
                <Text style={styles.buttonText}>{passwordLoading ? "Sending..." : "Send Verification Code"}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.hint}>Verification code sent to {user?.email}</Text>
              <TextInput
                style={styles.input}
                value={passwordCode}
                onChangeText={setPasswordCode}
                placeholder="6-digit code"
                keyboardType="number-pad"
                maxLength={6}
              />
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="New password"
                secureTextEntry
              />
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm new password"
                secureTextEntry
              />
              <TouchableOpacity style={styles.button} onPress={verifyPasswordChange} disabled={passwordLoading}>
                <Text style={styles.buttonText}>{passwordLoading ? "Updating..." : "Update Password"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkButton} onPress={() => setPasswordStep("form")}>
                <Text style={styles.linkText}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f5f5" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 15, backgroundColor: "#040f2d" },
  headerButton: { minWidth: 60, alignItems: "center" },
  backText: { color: "white", fontSize: 20, fontWeight: "bold" },
  headerTitle: { color: "white", fontSize: 18, fontWeight: "bold", flex: 1, textAlign: "center" },
  scrollContainer: { padding: 10 },
  section: { backgroundColor: "white", padding: 15, borderRadius: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#333", marginBottom: 10 },
  infoText: { fontSize: 14, color: "#666", marginBottom: 5 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16 },
  button: { backgroundColor: "#040f2d", padding: 15, borderRadius: 8, alignItems: "center", marginTop: 5 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  hint: { fontSize: 12, color: "#666", marginBottom: 10, fontStyle: "italic" },
  linkButton: { alignItems: "center", marginTop: 10 },
  linkText: { color: "#2563eb", fontSize: 14 },
});
