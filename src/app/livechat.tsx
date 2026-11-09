import React, { useState, useEffect, useRef } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, AppState } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import api from "../lib/api";
import { notifyNewMessage, seedConversation } from "../lib/notifications/alertCoordinator";
import { consumePendingConversationId, clearPendingConversationId } from "../lib/notifications/pendingConversation";
import { registerForPushIfPermitted, unregisterForPushNotifications } from "../lib/notifications/push";

interface Conversation {
  id: number;
  visitorName: string;
  visitorEmail: string;
  lastMessagePreview?: string;
  lastMessageId?: number | null;
  lastMessageSender?: string | null;
  unreadCount?: number;
  status?: string;
  muted?: boolean;
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
  const [authOk, setAuthOk] = useState(false);
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lastMessageIdRef = useRef<number>(0);
  const firstConversationLoadRef = useRef(true);
  const firstMessageLoadRef = useRef(true);
  const conversationsRef = useRef<Conversation[]>([]);
  const selectedConversationRef = useRef<number | null>(null);
  const handledParamRef = useRef<string | null>(null);
  const pushRegistrationAttemptedRef = useRef(false);
  const inFlightRef = useRef({ conversations: false, agents: false, messages: false });
  const retryTimeoutsRef = useRef<{ conversations?: any; agents?: any }>({});
  const params = useLocalSearchParams<{ conversationId?: string }>();

  useEffect(() => {
    const raw = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
    if (!raw || handledParamRef.current === raw) return;

    const id = Number(raw);
    if (!authOk || loading || !Number.isInteger(id) || id <= 0) return;

    handledParamRef.current = raw;
    consumePendingConversationId();
    setSelectedConversation(id);
    router.setParams({ conversationId: undefined });
  }, [params.conversationId, loading, authOk]);

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
        firstConversationLoadRef.current = true;
        firstMessageLoadRef.current = true;
        pushRegistrationAttemptedRef.current = false;
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
    };
  }, []);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
    if (selectedConversation) {
      lastMessageIdRef.current = 0;
      firstMessageLoadRef.current = true;
      loadMessages(selectedConversation);
      const interval = setInterval(() => {
        if (selectedConversationRef.current) {
          loadMessages(selectedConversationRef.current);
        }
      }, 2000);
      return () => clearInterval(interval);
    } else {
      lastMessageIdRef.current = 0;
      firstMessageLoadRef.current = true;
    }
  }, [selectedConversation]);

  const checkAuth = async () => {
    try {
      await api.get("/api/mobile/livechat/auth/me");
      setAuthOk(true);
      if (!pushRegistrationAttemptedRef.current) {
        pushRegistrationAttemptedRef.current = true;
        void registerForPushIfPermitted();
      }
      return true;
    } catch (error: any) {
      setAuthOk(false);
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
      const list: Conversation[] = Array.isArray(res.data) ? res.data : [];
      const first = firstConversationLoadRef.current;
      firstConversationLoadRef.current = false;

      for (const conversation of list) {
        if (!conversation.lastMessageId) continue;
        if (first) {
          seedConversation(conversation.id, conversation.lastMessageId);
        } else {
          notifyNewMessage({
            conversationId: conversation.id,
            messageId: conversation.lastMessageId,
            sender: conversation.lastMessageSender,
            muted: conversation.muted,
          });
        }
      }

      conversationsRef.current = list;
      setConversations(list);
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

  const loadMessages = async (conversationId: number) => {
    if (inFlightRef.current.messages) return;
    inFlightRef.current.messages = true;
    try {
      const res = await api.get(`/api/mobile/livechat/conversations/${conversationId}`);
      const newMessages: Message[] = Array.isArray(res.data?.messages) ? res.data.messages : [];
      const latest = newMessages.length > 0 ? newMessages[newMessages.length - 1] : null;
      const latestId = latest?.id ?? 0;

      if (firstMessageLoadRef.current) {
        if (latestId > 0) seedConversation(conversationId, latestId);
        firstMessageLoadRef.current = false;
      } else if (latest && lastMessageIdRef.current > 0 && latestId > lastMessageIdRef.current) {
        notifyNewMessage({
          conversationId,
          messageId: latestId,
          sender: latest.sender,
          muted: conversationsRef.current.find((c) => c.id === conversationId)?.muted,
        });
      }

      lastMessageIdRef.current = latestId;
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
      if (status === 404) {
        setSelectedConversation(null);
        loadConversations();
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

  const toggleMute = async () => {
    if (!selectedConversation) return;
    const current = conversationsRef.current.find((c) => c.id === selectedConversation);
    const nextMuted = !current?.muted;
    try {
      await api.patch(`/api/mobile/livechat/conversations/${selectedConversation}`, {
        muted: nextMuted,
      });
      const updated = conversationsRef.current.map((c) =>
        c.id === selectedConversation ? { ...c, muted: nextMuted } : c,
      );
      conversationsRef.current = updated;
      setConversations(updated);
      loadConversations();
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to update mute");
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
      await unregisterForPushNotifications();
    } catch {}
    clearPendingConversationId();
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
                {item.muted && <Text style={{ fontSize: 12, color: "#666", marginTop: 2 }}>Muted</Text>}
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
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={toggleMute} style={styles.headerButton}>
              <Text style={styles.logoutText}>
                {conversationsRef.current.find((c) => c.id === selectedConversation)?.muted
                  ? "Unmute"
                  : "Mute"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={closeConversation} style={styles.headerButton}>
              <Text style={styles.logoutText}>Close</Text>
            </TouchableOpacity>
          </View>
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
  headerRight: {
    flexDirection: "row",
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
