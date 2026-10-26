import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import api from "../lib/api";

interface Agent {
  id: number;
  name: string;
  email: string | null;
  status: "online" | "offline";
  createdAt: string;
}

export default function AgentsScreen() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchAgents = async () => {
    try {
      const response = await api.get("/api/mobile/livechat/agents");
      setAgents(response.data);
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to fetch agents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const addAgent = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Name is required");
      return;
    }
    setAdding(true);
    try {
      const response = await api.post("/api/mobile/livechat/agents", { name: name.trim(), email: email.trim() || null });
      setAgents([...agents, response.data]);
      setName("");
      setEmail("");
      Alert.alert("Success", "Agent added successfully");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to add agent");
    } finally {
      setAdding(false);
    }
  };

  const toggleStatus = async (agent: Agent) => {
    const newStatus = agent.status === "online" ? "offline" : "online";
    try {
      const response = await api.patch(`/api/mobile/livechat/agents/${agent.id}`, { status: newStatus });
      setAgents(agents.map((a) => (a.id === agent.id ? response.data : a)));
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to update status");
    }
  };

  const deleteAgent = async (agent: Agent) => {
    Alert.alert("Delete Agent", `Are you sure you want to delete ${agent.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/api/mobile/livechat/agents/${agent.id}`);
            setAgents(agents.filter((a) => a.id !== agent.id));
          } catch (error: any) {
            Alert.alert("Error", error.response?.data?.error || "Failed to delete agent");
          }
        },
      },
    ]);
  };

  const editAgent = async (agent: Agent) => {
    Alert.prompt(
      "Edit Agent",
      "Enter new name",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async (newName) => {
            if (!newName?.trim()) return;
            try {
              const response = await api.patch(`/api/mobile/livechat/agents/${agent.id}`, { name: newName.trim() });
              setAgents(agents.map((a) => (a.id === agent.id ? response.data : a)));
            } catch (error: any) {
              Alert.alert("Error", error.response?.data?.error || "Failed to update agent");
            }
          },
        },
      ],
      "plain-text",
      agent.name
    );
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
        <Text style={styles.headerTitle}>Agents</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.addSection}>
        <Text style={styles.sectionTitle}>Add Agent</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Full name"
        />
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.addButton} onPress={addAgent} disabled={adding}>
          <Text style={styles.addButtonText}>{adding ? "Adding..." : "Add Agent"}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={agents}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item }) => (
          <View style={styles.agentRow}>
            <View style={styles.agentInfo}>
              <Text style={styles.agentName}>{item.name}</Text>
              <Text style={styles.agentEmail}>{item.email || "-"}</Text>
              <Text style={[styles.agentStatus, item.status === "online" ? styles.statusOnline : styles.statusOffline]}>
                {item.status === "online" ? "Online" : "Offline"}
              </Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionButton} onPress={() => toggleStatus(item)}>
                <Text style={styles.actionText}>{item.status === "online" ? "Set Offline" : "Set Online"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={() => editAgent(item)}>
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={() => deleteAgent(item)}>
                <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No agents yet</Text>}
      />
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
  addSection: {
    backgroundColor: "white",
    padding: 15,
    margin: 10,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  addButton: {
    backgroundColor: "#040f2d",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  addButtonText: {
    color: "white",
    fontWeight: "600",
  },
  listContainer: {
    padding: 10,
  },
  agentRow: {
    backgroundColor: "white",
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
  },
  agentInfo: {
    marginBottom: 10,
  },
  agentName: {
    fontSize: 16,
    fontWeight: "bold",
  },
  agentEmail: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  agentStatus: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  statusOnline: {
    color: "#27a343",
  },
  statusOffline: {
    color: "#666",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionText: {
    fontSize: 12,
    color: "#333",
  },
  deleteButton: {
    backgroundColor: "#fee",
  },
  deleteText: {
    color: "#d33",
  },
  emptyText: {
    textAlign: "center",
    marginTop: 50,
    color: "#666",
  },
});
