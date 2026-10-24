import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import api from "../lib/api";

export default function LoginScreen() {
  const [step, setStep] = useState<"email" | "code" | "credentials">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setLoading(true);
    try {
      await api.post("/api/mobile/livechat/auth/send-code", { email });
      setStep("code");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    setLoading(true);
    try {
      await api.post("/api/mobile/livechat/auth/verify-code", { email, code });
      setStep("credentials");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    setLoading(true);
    try {
      await api.post("/api/mobile/livechat/auth/login", { email, username, password });
      router.replace("/livechat");
    } catch (err: any) {
      Alert.alert("Login Failed", err.response?.data?.error || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>KMCQ LiveChat Mobile</Text>
        <Text style={styles.subtitle}>Administrator Access Only</Text>
      </View>

      <View style={styles.card}>
        {step === "email" && (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.button} onPress={sendCode} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? "Sending..." : "Send Code"}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "code" && (
          <>
            <Text style={styles.label}>Verification Code</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
            />
            <TouchableOpacity style={styles.button} onPress={verifyCode} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? "Verifying..." : "Verify Code"}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "credentials" && (
          <>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              autoCapitalize="none"
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
            />
            <TouchableOpacity style={styles.button} onPress={login} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? "Logging in..." : "Login"}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#040f2d", padding: 20, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 30 },
  title: { fontSize: 28, fontWeight: "bold", color: "white" },
  subtitle: { fontSize: 16, color: "#27a343", marginTop: 5 },
  card: { backgroundColor: "white", padding: 30, borderRadius: 12 },
  label: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 16 },
  button: { backgroundColor: "#040f2d", padding: 15, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
});
