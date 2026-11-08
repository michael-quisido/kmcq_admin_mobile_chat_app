import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioSource,
} from "expo-audio";
import { getCustomSoundInfo } from "./customSound";

let player: AudioPlayer | null = null;

function disposePlayer(): void {
  if (!player) return;
  const current = player;
  player = null;
  try {
    current.remove();
  } catch {
    // Already released.
  }
}

async function playSource(source: AudioSource): Promise<boolean> {
  let next: AudioPlayer | null = null;
  try {
    next = createAudioPlayer(source, { updateInterval: 250 });
    player = next;
    next.volume = 1.0;

    const subscription = next.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish) return;
      subscription.remove();
      if (player === next) {
        player = null;
      }
      try {
        next?.remove();
      } catch {
        // Already released.
      }
    });

    next.play();
    return true;
  } catch {
    if (player === next) {
      player = null;
    }
    try {
      next?.remove();
    } catch {
      // Already released.
    }
    return false;
  }
}

export async function playAlertSound(): Promise<void> {
  try {
    disposePlayer();
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        allowsRecording: false,
        shouldRouteThroughEarpiece: false,
      });
    } catch {
      // Audio still often works; try the sound.
    }

    try {
      const info = await getCustomSoundInfo();
      if (info.uri && (await playSource({ uri: info.uri }))) {
        return;
      }
    } catch {
      // Fall through to the bundled sound.
    }

    try {
      const fallback = require("../../../assets/notification_sound/kmcq-gmbh-doorbell.mp3") as AudioSource;
      await playSource(fallback);
    } catch {
      // Never let a notification sound break polling.
    }
  } catch {
    // Never let a notification sound break polling.
  }
}

export function resetAlertSoundForTests(): void {
  disposePlayer();
}
