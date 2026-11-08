import React, { useState, useEffect, useRef } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, AppState } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import api from "../lib/api";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioSource } from "expo-audio";
import { getCustomSoundInfo } from "../lib/notifications/customSound";

interface Conversation {
  id: number;
  visitorName: string;
  visitorEmail: string;
  lastMessagePreview?: string;
  unreadCount?: number;
  status?: string;
}

interface Message {
  id: number;
  sender: string;
  body: string;
  createdAt: string;
}

export default function LiveChatScreen() {
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lastMessageIdRef = useRef<number>(0);
  const soundRef = useRef<AudioPlayer | null>(null);
  const selectedConversationRef = useRef<number | null>(null);
  const inFlightRef = useRef({ conversations: false, agents: false, messages: false });
  const retryTimeoutsRef = useRef<{ conversations?: any; agents?: any }>({});

  const scheduleRetry = (key: "conversations" | "agents", fn: () => Promise<void>) => {
    if (retryTimeoutsRef.current[key]) return;
    retryTimeoutsRef.current[key] = setTimeout(async () => {
      retryTimeoutsRef.current[key] = undefined;
      try {
        await fn();
      } catch {
        scheduleRetry(key, fn);
      }
    }, 3000);
  };

  useEffect(() => {
    checkAuth();
    loadConversations();
    loadAgents();
    const interval = setInterval(() => {
      loadConversations();
      loadAgents();
    }, 5000);
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        checkAuth().catch(() => {});
        loadConversations().catch(() => {});
        loadAgents().catch(() => {});
        if (selectedConversationRef.current) {
          loadMessages(selectedConversationRef.current).catch(() => {});
        }
      }
    });
    return () => {
      clearInterval(interval);
      appStateSub.remove();
      if (retryTimeoutsRef.current.conversations) clearTimeout(retryTimeoutsRef.current.conversations);
      if (retryTimeoutsRef.current.agents) clearTimeout(retryTimeoutsRef.current.agents);
      if (soundRef.current) {
        try {
          soundRef.current.remove();
        } catch {}
        soundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
    if (selectedConversation) {
      lastMessageIdRef.current = 0;
      loadMessages(selectedConversation);
      const interval = setInterval(() => {
        if (selectedConversationRef.current) {
          loadMessages(selectedConversationRef.current);
        }
      }, 2000);
      return () => clearInterval(interval);
    } else {
      lastMessageIdRef.current = 0;
    }
  }, [selectedConversation]);

  const checkAuth = async () => {
    try {
      await api.get("/api/mobile/livechat/auth/me");
      return true;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        router.replace("/login");
        return false;
      }
      return false;
    }
  };

  const loadAgents = async () => {
    if (inFlightRef.current.agents) return;
    inFlightRef.current.agents = true;
    try {
      const res = await api.get("/api/mobile/livechat/agents");
      setAgents(Array.isArray(res.data) ? res.data : []);
      if (retryTimeoutsRef.current.agents) {
        clearTimeout(retryTimeoutsRef.current.agents);
        retryTimeoutsRef.current.agents = undefined;
      }
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        router.replace("/login");
        return;
      }
      scheduleRetry("agents", loadAgents);
    } finally {
      inFlightRef.current.agents = false;
    }
  };

  const loadConversations = async () => {
    if (inFlightRef.current.conversations) return;
    inFlightRef.current.conversations = true;
    try {
      const res = await api.get("/api/mobile/livechat/conversations");
      setConversations(Array.isArray(res.data) ? res.data : []);
      if (retryTimeoutsRef.current.conversations) {
        clearTimeout(retryTimeoutsRef.current.conversations);
        retryTimeoutsRef.current.conversations = undefined;
      }
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        router.replace("/login");
        return;
      }
      scheduleRetry("conversations", loadConversations);
    } finally {
      setLoading(false);
      inFlightRef.current.conversations = false;
    }
  };

  const playNotificationSound = async () => {
    try {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: "duckOthers",
          allowsRecording: false,
          shouldRouteThroughEarpiece: false,
        });
      } catch {}
      try {
        if (soundRef.current) {
          try {
            soundRef.current.remove();
          } catch {}
          soundRef.current = null;
        }
        let source: AudioSource | null = null;
        try {
          const info = await getCustomSoundInfo();
          if (info.uri) {
            source = { uri: info.uri };
          }
        } catch {}
        if (!source) {
          try {
            source = require("../../assets/notification_sound/kmcq-gmbh-doorbell.mp3");
          } catch {}
        }
        if (!source) return;
        const player = createAudioPlayer(source, { updateInterval: 250 });
        soundRef.current = player;
        player.volume = 1.0;
        const subscription = player.addListener("playbackStatusUpdate", (status) => {
          if (status.didJustFinish) {
            subscription.remove();
            if (soundRef.current === player) {
              soundRef.current = null;
            }
            try {
              player.remove();
            } catch {}
          }
        });
        player.play();
      } catch {}
    } catch {
      // Do not log message content
    }
  };

  const loadMessages = async (conversationId: number) => {
    if (inFlightRef.current.messages) return;
    inFlightRef.current.messages = true;
    try {
      const res = await api.get(`/api/mobile/livechat/conversations/${conversationId}`);
      const newMessages = Array.isArray(res.data?.messages) ? res.data.messages : [];
      if (newMessages.length > 0) {
        const latestId = newMessages[newMessages.length - 1].id;
        if (lastMessageIdRef.current > 0 && latestId > lastMessageIdRef.current) {
          const latestMsg = newMessages[newMessages.length - 1];
          if (latestMsg.sender === "visitor" || latestMsg.sender === "system") {
            playNotificationSound();
          }
        }
        lastMessageIdRef.current = latestId;
      } else {
        lastMessageIdRef.current = 0;
      }
      setMessages((prev) => {
        if (prev.length === newMessages.length) {
          const same = prev.every((m, i) => m.id === newMessages[i]?.id && m.body === newMessages[i]?.body);
          if (same) return prev;
        }
        return newMessages;
      });
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        router.replace("/login");
        return;
      }
    } finally {
      inFlightRef.current.messages = false;
    }
  };

  const handleSelectConversation = async (conversationId: number) => {
    try {
      await loadAgents();
    } catch {}
    if (agents.length === 0) {
      Alert.alert("No agents", "Create an agent first");
      return;
    }
    Alert.alert(
      "Select Agent",
      "Choose which agent will respond",
      [
        ...agents.map((agent: any) => ({
          text: `${agent.name} (${agent.status})`,
          onPress: async () => {
            try {
              await api.patch(`/api/mobile/livechat/conversations/${conversationId}`, {
                assignedAgentId: agent.id,
              });
              setSelectedConversation(conversationId);
              lastMessageIdRef.current = 0;
              loadMessages(conversationId);
            } catch (error: any) {
              Alert.alert("Error", error.response?.data?.error || "Failed to assign agent");
            }
          },
        })),
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const closeConversation = async () => {
    if (!selectedConversation) return;
    Alert.alert("Close Conversation", "Are you sure you want to close this conversation?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Close",
        style: "destructive",
        onPress: async () => {
          try {
            await api.patch(`/api/mobile/livechat/conversations/${selectedConversation}`, {
              status: "closed",
            });
            setSelectedConversation(null);
            loadConversations();
            Alert.alert("Success", "Conversation closed");
          } catch (error: any) {
            Alert.alert("Error", error.response?.data?.error || "Failed to close conversation");
          }
        },
      },
    ]);
  };

  const reopenConversation = async (conversationId: number) => {
    try {
      await api.patch(`/api/mobile/livechat/conversations/${conversationId}`, {
        status: "open",
      });
      loadConversations();
      Alert.alert("Success", "Conversation reopened");
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to reopen conversation");
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sending) return;
    if (agents.length === 0) {
      Alert.alert("Error", "No agents available");
      return;
    }

    setSending(true);
    try {
      await api.post(`/api/mobile/livechat/conversations/${selectedConversation}/reply`, {
        body: newMessage,
        agentId: agents[0].id,
        clientNonce: Math.random().toString(36).substring(2, 15),
      });
      setNewMessage("");
      await loadMessages(selectedConversation);
      loadConversations();
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post("/api/mobile/livechat/auth/logout");
      router.replace("/login");
    } catch (error) {
      router.replace("/login");
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!selectedConversation) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.headerButton}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>LiveChat Conversations</Text>
          <TouchableOpacity onPress={handleLogout} style={styles.headerButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.conversationItem}
              onPress={() => {
                if (item.status === "closed") {
                  Alert.alert("Closed Conversation", "Do you want to reopen this conversation?", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Reopen",
                      onPress: () => reopenConversation(item.id),
                    },
                  ]);
                } else {
                  handleSelectConversation(item.id);
                }
              }}
              activeOpacity={0.7}
            >
              <View>
                <Text style={styles.conversationName}>
                  {(item.visitorName || item.visitorEmail || "Unknown User") + ""}
                </Text>
                {item.status === "closed" && <Text style={{ fontSize: 12, color: "#d33", marginTop: 2 }}>Closed</Text>}
                {item.lastMessagePreview ? (
                  <Text style={styles.conversationPreview} numberOfLines={1}>
                    {item.lastMessagePreview}
                  </Text>
                ) : null}
                {item.unreadCount && item.unreadCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{String(item.unreadCount)}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No conversations yet</Text>
          }
        />
        <Modal
          visible={menuVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setMenuVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          >
            <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                router.push("/account-settings");
              }}
            >
              <Text style={styles.menuItemText}>Account Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                router.push("/agents");
              }}
            >
              <Text style={styles.menuItemText}>Agents</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                router.push("/settings");
              }}
            >
              <Text style={styles.menuItemText}>LiveChat Settings</Text>
            </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedConversation(null)} style={styles.headerButton}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>Chat</Text>
          <TouchableOpacity onPress={closeConversation} style={styles.headerButton}>
            <Text style={styles.logoutText}>Close</Text>
          </TouchableOpacity>
        </View>
      
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.messagesContainer}
          renderItem={({ item }) => (
            <View
              style={[
                styles.messageBubble,
                item.sender === "agent" ? styles.adminMessage : item.sender === "visitor" ? styles.userMessage : styles.systemMessage,
              ]}
            >
              <Text style={[styles.messageText, item.sender === "agent" && styles.adminMessageText]}>{item.body}</Text>
            </View>
          )}
        />
        
        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            style={styles.messageInput}
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder="Type a message..."
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, (!newMessage.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSendMessage}
            disabled={!newMessage.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      <Modal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuContainer}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push("/agents");
            }}
          >
            <Text style={styles.menuItemText}>Agents</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push("/settings");
            }}
          >
            <Text style={styles.menuItemText}>LiveChat Settings</Text>
          </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
  menuIcon: {
    color: "white",
    fontSize: 24,
  },
  headerTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  backText: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  logoutText: {
    color: "white",
    fontSize: 14,
  },
  conversationItem: {
    padding: 15,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  conversationName: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 5,
    paddingRight: 30,
  },
  conversationPreview: {
    fontSize: 14,
    color: "#666",
    paddingRight: 30,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 50,
    color: "#666",
    fontSize: 16,
  },
  messagesContainer: {
    padding: 10,
    paddingBottom: 20,
  },
  messageBubble: {
    maxWidth: "80%",
    padding: 10,
    borderRadius: 10,
    marginVertical: 5,
  },
  adminMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#2563eb",
  },
  userMessage: {
    alignSelf: "flex-start",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  systemMessage: {
    alignSelf: "center",
    backgroundColor: "#f0f0f0",
  },
  adminMessageText: {
    color: "white",
  },
  messageText: {
    color: "black",
  },
  badge: {
    position: "absolute",
    right: 10,
    top: 10,
    backgroundColor: "#27a343",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  inputContainer: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingTop: 10,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  messageInput: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: "#2563eb",
    borderRadius: 20,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: "white",
    fontWeight: "bold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  menuContainer: {
    position: "absolute",
    top: 90,
    left: 10,
    backgroundColor: "white",
    borderRadius: 8,
    paddingVertical: 8,
    width: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 16,
    color: "#333",
  },
});
