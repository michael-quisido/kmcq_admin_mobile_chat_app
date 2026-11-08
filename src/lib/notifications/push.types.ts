export type NotificationPermission = "granted" | "denied" | "undetermined" | "unsupported";

export type PushTestResult = {
  sent: number;
  failed: number;
  tokens: number;
};
