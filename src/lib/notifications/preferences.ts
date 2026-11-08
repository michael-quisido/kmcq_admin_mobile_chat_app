import * as SecureStore from "expo-secure-store";

const SOUNDS_ENABLED_KEY = "kmcq_notification_sounds_enabled";

let cachedSoundsEnabled = true;

export async function loadSoundsEnabled(): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(SOUNDS_ENABLED_KEY);
    cachedSoundsEnabled = stored === null ? true : stored === "true";
  } catch {
    cachedSoundsEnabled = true;
  }
  return cachedSoundsEnabled;
}

export function isSoundsEnabled(): boolean {
  return cachedSoundsEnabled;
}

export async function setSoundsEnabled(enabled: boolean): Promise<void> {
  cachedSoundsEnabled = enabled;
  try {
    await SecureStore.setItemAsync(SOUNDS_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // The in-memory value still applies for this session.
  }
}
