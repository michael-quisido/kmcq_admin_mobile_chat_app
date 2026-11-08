import * as SecureStore from "expo-secure-store";

const SOUNDS_ENABLED_KEY = "kmcq_notification_sounds_enabled";

let cachedSoundsEnabled = true;
let cacheVersion = 0;

export async function loadSoundsEnabled(): Promise<boolean> {
  const versionAtStart = cacheVersion;
  try {
    const stored = await SecureStore.getItemAsync(SOUNDS_ENABLED_KEY);
    if (versionAtStart === cacheVersion) {
      cachedSoundsEnabled = stored !== "false";
    }
  } catch {
    // Preserve the current cached value when storage is unavailable.
  }
  return cachedSoundsEnabled;
}

export function isSoundsEnabled(): boolean {
  return cachedSoundsEnabled;
}

export async function setSoundsEnabled(enabled: boolean): Promise<void> {
  cacheVersion += 1;
  cachedSoundsEnabled = enabled;
  try {
    await SecureStore.setItemAsync(SOUNDS_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // The in-memory value still applies for this session.
  }
}
