import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  AppState,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import api from "../lib/api";
import { Conversation, fetchConversations } from "../lib/livechat/conversations";
import { notifyNewMessage, seedConversation } from "../lib/notifications/alertCoordinator";
import { consumePendingConversationId, clearPendingConversationId } from "../lib/notifications/pendingConversation";
import {
  registerForPushIfPermitted,
  setPushAuthEnabled,
  unregisterForPushNotifications,
} from "../lib/notifications/push";
import { clearLivechatConversationBubble } from "../lib/notifications/livechatBubbles";

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
  const [conversationsError, setConversationsError] = useState(false);
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

  useFocusEffect(
    useCallback(() => {
      const raw = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
      if (!raw) {
        handledParamRef.current = null;
        return;
      }
      if (handledParamRef.current === raw) return;

      const id = Number(raw);
      if (!authOk || loading || !Number.isInteger(id) || id <= 0) return;

      handledParamRef.current = raw;
      consumePendingConversationId();
      setSelectedConversation(id);
      router.setParams({ conversationId: undefined });
    }, [params.conversationId, loading, authOk]),
  );

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
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      try {
        await checkAuth();
        await Promise.allSettled([loadConversations(), loadAgents()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    const loadingGuard = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 12000);
    const interval = setInterval(() => {
      loadConversations();
      loadAgents();
    }, 5000);
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        firstConversationLoadRef.current = true;
        firstMessageLoadRef.current = true;
        pushRegistrationAttemptedRef.current = false;
        void (async () => {
          await checkAuth().catch(() => {});
          await Promise.allSettled([loadConversations(), loadAgents()]);
          if (selectedConversationRef.current) {
            await loadMessages(selectedConversationRef.current).catch(() => {});
          }
        })();
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(loadingGuard);
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
      setPushAuthEnabled(true);
      if (!pushRegistrationAttemptedRef.current) {
        pushRegistrationAttemptedRef.current = true;
        void registerForPushIfPermitted();
      }
      return true;
    } catch (error: any) {
      setAuthOk(false);
      setPushAuthEnabled(false);
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
      const result = await fetchConversations();
      if (result.status === "unauthorized") {
        router.replace("/login");
        return;
      }
      if (result.status === "error") {
        setConversationsError(true);
        return;
      }
      setConversationsError(false);
      if (retryTimeoutsRef.current.conversations) {
        clearTimeout(retryTimeoutsRef.current.conversations);
        retryTimeoutsRef.current.conversations = undefined;
      }
      const convs = result.conversations;
      if (firstConversationLoadRef.current) {
        firstConversationLoadRef.current = false;
        for (const conv of convs) {
          const newest = conv.lastMessageId ?? 0;
          seedConversation(conv.id, newest);
        }
      }
      for (const conv of convs) {
        if (conv.lastMessageId != null) {
          notifyNewMessage({
            conversationId: conv.id,
            messageId: conv.lastMessageId,
            sender: conv.lastMessageSender,
            muted: conv.muted,
          });
        }
      }
      setConversations(convs);
    } catch (error) {
      setConversationsError(true);
    } finally {
      inFlightRef.current.conversations = false;
    }
  };

  const loadMessages = async (conversationId: number) => {
    if (inFlightRef.current.messages) return;
    inFlightRef.current.messages = true;
    try {
      const res = await api.get(`/api/mobile/livechat/conversations/${conversationId}`);
      const data = res.data as any;
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      if (data.status && data.status !== "open") {
        setConversations((prev) => {
          const exists = prev.find((c) => c.id === conversationId);
          if (!exists) {
            return [
              ...prev,
              {
                id: conversationId,
                visitorName: data.visitorName ?? "Unknown User",
                visitorEmail: data.visitorEmail ?? "",
                status: data.status,
                lastMessageSender: null,
                lastMessageId: null,
                lastMessagePreview: null,
                unreadCount: 0,
                muted: false,
              },
            ];
          }
          return prev.map((c) => (c.id === conversationId ? { ...c, ...data } : c));
        });
      }
      const conversation = data as Conversation;
      if (firstMessageLoadRef.current) {
        firstMessageLoadRef.current = false;
        lastMessageIdRef.current = conversation.lastMessageId ?? 0;
      } else if (data.lastMessageId != null && data.lastMessageId > lastMessageIdRef.current) {
        notifyNewMessage({
          conversationId,
          messageId: data.lastMessageId,
          sender: data.lastMessageSender,
          muted: data.muted,
        });
        lastMessageIdRef.current = data.lastMessageId;
      }
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, ...data } : c)));
    } catch (error) {
      // Ignore errors
    } finally {
      inFlightRef.current.messages = false;
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
    setPushAuthEnabled(false);
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

  const handleSelectConversation = async (id: number) => {
    setSelectedConversation(id);
    try {
      await clearLivechatConversationBubble(id);
    } catch {}
  };

  const reopenConversation = async (conversationId: number) => {
    try {
      await api.post(`/api/mobile/livechat/conversations/${conversationId}/reopen`);
      await loadConversations();
      handleSelectConversation(conversationId);
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to reopen conversation");
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
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.headerButton}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>LiveChat Conversations</Text>
          <TouchableOpacity onPress={handleLogout} style={styles.headerButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
        {conversationsError && conversations.length > 0 ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>Could not refresh conversations.</Text>
            <TouchableOpacity
              onPress={() => {
                setConversationsError(false);
                loadConversations();
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {conversations.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No conversations yet</Text>
          </View>
        ) : (
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
                      { text: "Reopen", onPress: () => reopenConversation(item.id) },
                    ]);
                  } else {
                    handleSelectConversation(item.id);
                  }
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.conversationName}>{item.visitorName || "Unknown User"}</Text>
                  {item.visitorEmail ? <Text style={styles.conversationEmail}>{item.visitorEmail}</Text> : null}
                  {item.muted ? <Text style={styles.mutedText}>Muted</Text> : null}
                </View>
                <View style={styles.conversationMeta}>
                  {(item.unreadCount ?? 0) > 0 ? (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        <Modal visible={menuVisible} transparent animationType="fade">
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
            <View style={styles.menuContent}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  router.push("/account-settings");
                }}
              >
                <Text style={styles.menuText}>Account Settings</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  router.push("/agents");
                }}
              >
                <Text style={styles.menuText}>Agents</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  router.push("/settings");
                }}
              >
                <Text style={styles.menuText}>Settings</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setSelectedConversation(null)} style={styles.headerButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {conversations.find((c) => c.id === selectedConversation)?.visitorName || "Chat"}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.messageBubble, item.sender === "agent" ? styles.agentMessage : styles.visitorMessage]}>
            <Text style={[styles.messageText, item.sender === "agent" ? styles.agentMessageText : styles.visitorMessageText]}>
              {item.body}
            </Text>
            <Text style={[styles.messageTime, item.sender === "agent" ? styles.agentMessageTime : styles.visitorMessageTime]}>
              {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Text>
          </View>
        )}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 52 : 0}
        style={styles.kav}
      >
        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            style={styles.input}
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
            <Text style={styles.sendButtonText}>{sending ? "..." : "Send"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#040f2d",
  },
  headerButton: { minWidth: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "600", flex: 1, textAlign: "center" },
  backText: { color: "#fff", fontSize: 24 },
  menuIcon: { color: "#fff", fontSize: 24 },
  logoutText: { color: "#fff", fontSize: 14 },
  errorBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#fecaca",
  },
  errorBannerText: { color: "#991b1b", flex: 1 },
  retryText: { color: "#2563eb", fontWeight: "600", marginLeft: 8 },
  conversationItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  conversationName: { fontSize: 16, fontWeight: "600", color: "#111" },
  conversationEmail: { fontSize: 13, color: "#666", marginTop: 2 },
  mutedText: { fontSize: 12, color: "#888", marginTop: 2 },
  conversationMeta: { alignItems: "flex-end", marginLeft: 8 },
  unreadBadge: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  unreadBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  emptyText: { color: "#666", fontSize: 16 },
  messagesList: { padding: 12 },
  messageBubble: { maxWidth: "80%", padding: 10, borderRadius: 12, marginBottom: 8 },
  agentMessage: { alignSelf: "flex-end", backgroundColor: "#2563eb" },
  visitorMessage: { alignSelf: "flex-start", backgroundColor: "#e5e7eb" },
  messageText: { fontSize: 15 },
  agentMessageText: { color: "#fff" },
  visitorMessageText: { color: "#111" },
  messageTime: { fontSize: 11, marginTop: 4 },
  agentMessageTime: { color: "rgba(255,255,255,0.8)", textAlign: "right" },
  visitorMessageTime: { color: "#666" },
  kav: { flexShrink: 0 },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 15,
    backgroundColor: "#fff",
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: "#2563eb",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#fff", fontWeight: "600" },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "flex-start" },
  menuContent: { backgroundColor: "#fff", marginTop: 60, marginHorizontal: 12, borderRadius: 8, overflow: "hidden" },
  menuItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  menuText: { fontSize: 16, color: "#111" },
});