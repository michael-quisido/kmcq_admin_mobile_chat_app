import type { NotificationPermission, PushTestResult } from "./push.types";

export async function configureNotifications(): Promise<void> {}
export async function getNotificationPermission(): Promise<NotificationPermission> {
  return "unsupported";
}
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return "unsupported";
}
export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}
export async function registerForPushIfPermitted(): Promise<string | null> {
  return null;
}
export async function unregisterForPushNotifications(_token?: string): Promise<void> {}
export async function sendTestMobilePush(): Promise<PushTestResult> {
  return { sent: 0, failed: 0, tokens: 0 };
}
export function handleNotificationReceived(_notification: unknown): void {}
export function handleNotificationResponse(_response: unknown, _navigate = true): void {}
