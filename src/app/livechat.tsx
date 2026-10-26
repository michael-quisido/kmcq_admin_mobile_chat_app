import React, { useState, useEffect, useRef } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import api from "../lib/api";

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    checkAuth();
    loadConversations();
    loadAgents();
    const interval = setInterval(loadConversations, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkAuth = async () => {
    try {
      await api.get("/api/mobile/livechat/auth/me");
    } catch (error) {
      router.replace("/login");
    }
  };

  const loadAgents = async () => {
    try {
      const res = await api.get("/api/mobile/livechat/agents");
      setAgents(res.data);
    } catch (error) {
      console.error("Failed to load agents", error);
    }
  };

  const loadConversations = async () => {
    try {
      const res = await api.get("/api/mobile/livechat/conversations");
      setConversations(res.data);
    } catch (error) {
      console.error("Failed to load conversations", error);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (conversationId: number) => {
    try {
      const res = await api.get(`/api/mobile/livechat/conversations/${conversationId}`);
      setMessages(res.data.messages || []);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error("Failed to load messages", error);
    }
  };

  const handleSelectConversation = (conversationId: number) => {
    setSelectedConversation(conversationId);
    loadMessages(conversationId);
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
              onPress={() => handleSelectConversation(item.id)}
              activeOpacity={0.7}
            >
              <View>
                <Text style={styles.conversationName}>
                  {(item.visitorName || item.visitorEmail || "Unknown User") + ""}
                </Text>
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
        <TouchableOpacity onPress={handleLogout} style={styles.headerButton}>
          <Text style={styles.logoutText}>Logout</Text>
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
        
        <View style={styles.inputContainer}>
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
                Alert.alert("Inbox", "Inbox feature");
              }}
            >
              <Text style={styles.menuItemText}>Inbox</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                Alert.alert("Agents", "Agents feature");
              }}
            >
              <Text style={styles.menuItemText}>Agents</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                Alert.alert("LiveChat Settings", "LiveChat Settings feature");
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
    padding: 10,
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
