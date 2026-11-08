import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioSource,
} from "expo-audio";
import { getCustomSoundInfo } from "./customSound";

type PlayerSubscription = ReturnType<AudioPlayer["addListener"]>;

type ActiveSound = {
  player: AudioPlayer;
  subscription: PlayerSubscription;
};

let active: ActiveSound | null = null;

function release(
  targetPlayer: AudioPlayer | null,
  targetSubscription: PlayerSubscription | null,
): void {
  if (active?.player === targetPlayer) {
    active = null;
  }
  try {
    targetSubscription?.remove();
  } catch {
    // Already released.
  }
  try {
    targetPlayer?.remove();
  } catch {
    // Already released.
  }
}

function disposePlayer(): void {
  if (!active) return;
  release(active.player, active.subscription);
}

function getBundledSound(): AudioSource {
  return require("../../../assets/notification_sound/kmcq-gmbh-doorbell.mp3") as AudioSource;
}

async function playSource(
  source: AudioSource,
  fallbackSource: AudioSource | null,
): Promise<boolean> {
  disposePlayer();

  let next: AudioPlayer | null = null;
  let nextSubscription: PlayerSubscription | null = null;

  try {
    next = createAudioPlayer(source, { updateInterval: 250 });
    next.volume = 1.0;

    nextSubscription = next.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        release(next, nextSubscription);
        return;
      }

      if (status.error) {
        const wasCurrent = active?.player === next;
        release(next, nextSubscription);
        if (wasCurrent && fallbackSource) {
          void playSource(fallbackSource, null);
        }
      }
    });

    active = { player: next, subscription: nextSubscription };

    next.play();
    return true;
  } catch {
    release(next, nextSubscription);
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
      if (info.uri && (await playSource({ uri: info.uri }, getBundledSound()))) {
        return;
      }
    } catch {
      // Fall through to the bundled sound.
    }

    try {
      await playSource(getBundledSound(), null);
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
