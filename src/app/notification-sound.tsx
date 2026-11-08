import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { File } from "expo-file-system";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioSource } from "expo-audio";
import { getCustomSoundInfo, saveCustomSoundFromPicked, clearCustomSound } from "../lib/notifications/customSound";

export default function NotificationSoundScreen() {
  const [info, setInfo] = useState<{ uri: string | null; name: string | null }>({ uri: null, name: null });
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const i = await getCustomSoundInfo();
      setInfo(i);
    } catch {
      setInfo({ uri: null, name: null });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.remove();
        } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  const pickSound = async () => {
    setPicking(true);
    try {
      const res = await File.pickFileAsync({
        mimeTypes: ["audio/*"],
        multipleFiles: false,
      } as any);
      if ((res as any).canceled || !(res as any).result) {
        return;
      }
      const picked = (res as any).result as File;
      const result = await saveCustomSoundFromPicked(picked);
      if (!result.ok) {
        Alert.alert("Error", result.error || "Failed to set sound");
        return;
      }
      await load();
      Alert.alert("Success", "Custom notification sound saved");
    } catch (e: any) {
      Alert.alert("Error", "Failed to select sound");
    } finally {
      setPicking(false);
    }
  };

  const preview = async () => {
    try {
      if (playing && playerRef.current) {
        try {
          playerRef.current.pause();
        } catch {}
        try {
          playerRef.current.remove();
        } catch {}
        playerRef.current = null;
        setPlaying(false);
        return;
      }
      if (playerRef.current) {
        try {
          playerRef.current.remove();
        } catch {}
        playerRef.current = null;
      }
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: "duckOthers",
          allowsRecording: false,
          shouldRouteThroughEarpiece: false,
        });
      } catch {}
      let source: AudioSource | null = null;
      if (info.uri) {
        source = { uri: info.uri };
      }
      if (!source) {
        try {
          source = require("../../assets/notification_sound/kmcq-gmbh-doorbell.mp3");
        } catch {}
      }
      if (!source) {
        Alert.alert("Error", "No sound available");
        return;
      }
      let player: AudioPlayer;
      try {
        player = createAudioPlayer(source, { updateInterval: 250 });
      } catch {
        Alert.alert("Error", "Failed to play sound");
        return;
      }
      playerRef.current = player;
      setPlaying(true);
      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) {
          subscription.remove();
          if (playerRef.current === player) {
            playerRef.current = null;
            setPlaying(false);
          }
          try {
            player.remove();
          } catch {}
        }
      });
      player.volume = 1.0;
      player.play();
    } catch {
      Alert.alert("Error", "Cannot play this audio file");
      setPlaying(false);
    }
  };

  const resetToDefault = async () => {
    try {
      await clearCustomSound();
      await load();
      Alert.alert("Reset", "Using default notification sound");
    } catch {
      Alert.alert("Error", "Failed to reset");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/settings"); }} style={styles.headerButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification Sound</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color="#2563eb" />
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.label}>Current sound</Text>
              <Text style={styles.value}>{info.name ? info.name : "Default (KMCQ doorbell)"}</Text>
              <Text style={styles.hint}>Selected files are copied to private app storage. On Android, changing an existing notification channel sound may be limited by system settings.</Text>
            </View>

            <TouchableOpacity style={styles.button} onPress={pickSound} disabled={picking}>
              <Text style={styles.buttonText}>{picking ? "Selecting..." : "Choose audio file from device"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.buttonSecondary} onPress={preview}>
              <Text style={styles.buttonSecondaryText}>{playing ? "Stop preview" : "Preview"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.buttonSecondary} onPress={resetToDefault}>
              <Text style={styles.buttonSecondaryText}>Reset to default</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 15, backgroundColor: "#040f2d" },
  headerButton: { minWidth: 60, alignItems: "center" },
  backText: { color: "white", fontSize: 20, fontWeight: "bold" },
  headerTitle: { color: "white", fontSize: 18, fontWeight: "bold", flex: 1, textAlign: "center" },
  content: { padding: 15 },
  section: { backgroundColor: "white", padding: 15, borderRadius: 8, marginBottom: 15 },
  label: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 6 },
  value: { fontSize: 14, color: "#555" },
  hint: { fontSize: 12, color: "#666", marginTop: 8 },
  button: { backgroundColor: "#2563eb", padding: 12, borderRadius: 6, alignItems: "center", marginBottom: 10 },
  buttonText: { color: "white", fontWeight: "600" },
  buttonSecondary: { backgroundColor: "#e5e7eb", padding: 12, borderRadius: 6, alignItems: "center", marginBottom: 10 },
  buttonSecondaryText: { color: "#111827", fontWeight: "600" },
});
