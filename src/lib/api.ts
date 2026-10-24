import axios from "axios";
import * as SecureStore from "expo-secure-store";

const API_BASE_URL = "http://192.168.5.89:3000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export async function login(username: string, password: string) {
  const response = await api.post("/api/auth/login", { username, password });
  return response.data;
}

export async function logout() {
  await api.post("/api/auth/logout");
  await SecureStore.deleteItemAsync("token");
}

export async function getMe() {
  const response = await api.get("/api/auth/me");
  return response.data;
}

export async function getLiveChatConversations() {
  const response = await api.get("/api/admin/livechat/conversations");
  return response.data;
}

export async function getLiveChatMessages(conversationId: string) {
  const response = await api.get(`/api/admin/livechat/messages?conversationId=${conversationId}`);
  return response.data;
}

export async function sendLiveChatMessage(conversationId: string, message: string) {
  const response = await api.post("/api/admin/livechat/messages", { conversationId, message });
  return response.data;
}
