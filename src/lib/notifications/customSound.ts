import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY_URI = "kmcq_notification_custom_sound_uri";
const STORAGE_KEY_NAME = "kmcq_notification_custom_sound_name";
const CUSTOM_SOUND_DIR = new Directory(Paths.document, "notification_sounds");
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DURATION_SECONDS = 30;

export async function ensureCustomSoundDir(): Promise<void> {
  try {
    if (!CUSTOM_SOUND_DIR.exists) {
      CUSTOM_SOUND_DIR.create({ intermediates: true, idempotent: true });
    }
  } catch {
    // ignore
  }
}

export async function getCustomSoundInfo(): Promise<{ uri: string | null; name: string | null }> {
  try {
    const uri = await SecureStore.getItemAsync(STORAGE_KEY_URI);
    const name = await SecureStore.getItemAsync(STORAGE_KEY_NAME);
    return { uri, name };
  } catch {
    return { uri: null, name: null };
  }
}

export async function clearCustomSound(): Promise<void> {
  try {
    const info = await getCustomSoundInfo();
    if (info.uri) {
      try {
        const f = new File(info.uri);
        if (f.exists) {
          f.delete();
        }
      } catch {}
    }
  } catch {}
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY_URI);
    await SecureStore.deleteItemAsync(STORAGE_KEY_NAME);
  } catch {}
}

function validateAudioFile(file: File): { ok: boolean; error?: string } {
  try {
    if (!file.exists) {
      return { ok: false, error: "Selected file does not exist." };
    }
    const size = (file as any).size;
    if (typeof size === "number" && size > MAX_FILE_SIZE_BYTES) {
      return { ok: false, error: "File is too large (max 5 MB)." };
    }
    if (typeof size === "number" && size < 0) {
      return { ok: false, error: "Invalid file." };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: "Unable to access selected file." };
  }
}

export async function saveCustomSoundFromPicked(picked: File): Promise<{ ok: boolean; uri?: string; name?: string; error?: string }> {
  try {
    await ensureCustomSoundDir();
    const v = validateAudioFile(picked);
    if (!v.ok) return { ok: false, error: v.error };

    // Clean up previous
    await clearCustomSound();

    const ext = picked.extension && picked.extension.startsWith(".") ? picked.extension : picked.extension ? `.${picked.extension}` : ".mp3";
    const name = picked.name || `custom${ext}`;
    const dest = new File(CUSTOM_SOUND_DIR, `custom_notification${ext}`);

    // Copy file to private storage
    try {
      // copy() may not exist in all versions; try different approaches
      if (typeof (picked as any).copy === "function") {
        (picked as any).copy(dest);
      } else if (typeof (File as any).copy === "function") {
        (File as any).copy(picked, dest);
      } else {
        // Fallback: read as bytes and write
        const bytes = await (picked as any).bytes?.();
        if (bytes) {
          dest.create({ overwrite: true });
          await (dest as any).write?.(bytes);
        } else {
          throw new Error("copy_not_supported");
        }
      }
    } catch (e: any) {
      return { ok: false, error: "Failed to copy file to app storage." };
    }

    if (!dest.exists) {
      return { ok: false, error: "Failed to save sound." };
    }

    const size = (dest as any).size;
    if (typeof size === "number" && size > MAX_FILE_SIZE_BYTES) {
      try { dest.delete(); } catch {}
      return { ok: false, error: "File is too large (max 5 MB)." };
    }

    try {
      await SecureStore.setItemAsync(STORAGE_KEY_URI, dest.uri);
      await SecureStore.setItemAsync(STORAGE_KEY_NAME, name);
    } catch {
      try { dest.delete(); } catch {}
      return { ok: false, error: "Failed to save preference." };
    }

    return { ok: true, uri: dest.uri, name };
  } catch (e: any) {
    return { ok: false, error: "Failed to save sound." };
  }
}

export { MAX_DURATION_SECONDS, MAX_FILE_SIZE_BYTES };
