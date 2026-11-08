import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
}));
jest.mock("../customSound", () => ({ getCustomSoundInfo: jest.fn() }));

import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { getCustomSoundInfo } from "../customSound";
import { playAlertSound, resetAlertSoundForTests } from "../playAlertSound";

const createPlayer = jest.mocked(createAudioPlayer);
const setAudioMode = jest.mocked(setAudioModeAsync);
const customSound = jest.mocked(getCustomSoundInfo);

type PlaybackStatus = { didJustFinish?: boolean; error?: string | null };

function playerMock() {
  const subscription = { remove: jest.fn() };
  let listener: ((status: PlaybackStatus) => void) | null = null;
  return {
    volume: 1,
    subscription,
    addListener: jest.fn((_event: string, callback: (status: PlaybackStatus) => void) => {
      listener = callback;
      return subscription;
    }),
    play: jest.fn(),
    remove: jest.fn(),
    emitStatus(status: PlaybackStatus) {
      listener?.(status);
    },
  };
}

beforeEach(() => {
  resetAlertSoundForTests();
  createPlayer.mockReset();
  setAudioMode.mockReset();
  setAudioMode.mockResolvedValue(undefined);
  customSound.mockReset();
});

describe("playAlertSound", () => {
  it("plays the custom sound when one is stored", async () => {
    const player = playerMock();
    createPlayer.mockReturnValue(player as never);
    customSound.mockResolvedValue({ uri: "file:///custom.mp3", name: "Custom" });

    await playAlertSound();

    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(createPlayer).toHaveBeenCalledWith({ uri: "file:///custom.mp3" }, { updateInterval: 250 });
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bundled sound when the custom sound cannot be created", async () => {
    const fallback = playerMock();
    createPlayer.mockImplementationOnce(() => {
      throw new Error("bad custom file");
    });
    createPlayer.mockImplementationOnce(() => fallback as never);
    customSound.mockResolvedValue({ uri: "file:///custom.mp3", name: "Custom" });

    await playAlertSound();

    expect(createPlayer).toHaveBeenCalledTimes(2);
    expect(createPlayer.mock.calls[1][0]).not.toEqual({ uri: "file:///custom.mp3" });
    expect(fallback.play).toHaveBeenCalledTimes(1);
  });

  it("uses the bundled sound when no custom sound exists", async () => {
    const player = playerMock();
    createPlayer.mockReturnValue(player as never);
    customSound.mockResolvedValue({ uri: null, name: null });

    await playAlertSound();

    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("never throws when audio mode setup fails", async () => {
    const player = playerMock();
    setAudioMode.mockRejectedValueOnce(new Error("audio unavailable"));
    createPlayer.mockReturnValue(player as never);
    customSound.mockResolvedValue({ uri: null, name: null });

    await expect(playAlertSound()).resolves.toBeUndefined();
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("removes the subscription and player when playback finishes", async () => {
    const player = playerMock();
    createPlayer.mockReturnValue(player as never);
    customSound.mockResolvedValue({ uri: "file:///custom.mp3", name: "Custom" });

    await playAlertSound();
    player.emitStatus({ didJustFinish: true });

    expect(player.subscription.remove).toHaveBeenCalledTimes(1);
    expect(player.remove).toHaveBeenCalledTimes(1);
  });

  it("disposes the previous player when called again", async () => {
    const first = playerMock();
    const second = playerMock();
    createPlayer.mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);
    customSound.mockResolvedValue({ uri: null, name: null });

    await playAlertSound();
    expect(first.play).toHaveBeenCalledTimes(1);
    expect(first.remove).not.toHaveBeenCalled();

    await playAlertSound();

    expect(first.subscription.remove).toHaveBeenCalledTimes(1);
    expect(first.remove).toHaveBeenCalledTimes(1);
    expect(second.play).toHaveBeenCalledTimes(1);
  });

  it("plays the bundled fallback when the custom player reports an error", async () => {
    const custom = playerMock();
    const fallback = playerMock();
    createPlayer.mockReturnValueOnce(custom as never).mockReturnValueOnce(fallback as never);
    customSound.mockResolvedValue({ uri: "file:///custom.mp3", name: "Custom" });

    await playAlertSound();
    expect(createPlayer).toHaveBeenCalledTimes(1);

    custom.emitStatus({ error: "decode failed" });
    await Promise.resolve();

    expect(custom.subscription.remove).toHaveBeenCalledTimes(1);
    expect(custom.remove).toHaveBeenCalledTimes(1);
    expect(createPlayer).toHaveBeenCalledTimes(2);
    expect(createPlayer.mock.calls[1][0]).not.toEqual({ uri: "file:///custom.mp3" });
    expect(fallback.play).toHaveBeenCalledTimes(1);
  });

  it("does not loop the bundled sound when it reports an error", async () => {
    const fallback = playerMock();
    createPlayer.mockReturnValue(fallback as never);
    customSound.mockResolvedValue({ uri: null, name: null });

    await playAlertSound();
    fallback.emitStatus({ error: "decode failed" });
    await Promise.resolve();

    expect(fallback.subscription.remove).toHaveBeenCalledTimes(1);
    expect(fallback.remove).toHaveBeenCalledTimes(1);
    expect(createPlayer).toHaveBeenCalledTimes(1);
  });
});
