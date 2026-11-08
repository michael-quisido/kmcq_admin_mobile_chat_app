import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type * as Preferences from "../preferences";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

type SecureStoreMock = {
  __store: Map<string, string>;
  getItemAsync: jest.MockedFunction<(key: string) => Promise<string | null>>;
  setItemAsync: jest.MockedFunction<(key: string, value: string) => Promise<void>>;
};

function secureStore(): SecureStoreMock {
  return jest.requireMock("expo-secure-store") as SecureStoreMock;
}

beforeEach(() => {
  jest.resetModules();
});

describe("sounds preference", () => {
  it("defaults to enabled when nothing is stored", async () => {
    const { loadSoundsEnabled, isSoundsEnabled } = require("../preferences") as typeof Preferences;
    await expect(loadSoundsEnabled()).resolves.toBe(true);
    expect(isSoundsEnabled()).toBe(true);
  });

  it("loads a stored false value", async () => {
    const { loadSoundsEnabled, isSoundsEnabled } = require("../preferences") as typeof Preferences;
    secureStore().__store.set("kmcq_notification_sounds_enabled", "false");
    await expect(loadSoundsEnabled()).resolves.toBe(false);
    expect(isSoundsEnabled()).toBe(false);
  });

  it("updates the cache and storage when changed", async () => {
    const { isSoundsEnabled, setSoundsEnabled } = require("../preferences") as typeof Preferences;
    await setSoundsEnabled(false);
    expect(isSoundsEnabled()).toBe(false);
    expect(secureStore().setItemAsync).toHaveBeenCalledWith("kmcq_notification_sounds_enabled", "false");
  });

  it("preserves a prior false cache when reading storage fails", async () => {
    const { loadSoundsEnabled, isSoundsEnabled, setSoundsEnabled } =
      require("../preferences") as typeof Preferences;
    await setSoundsEnabled(false);
    secureStore().getItemAsync.mockRejectedValueOnce(new Error("read failed"));
    await expect(loadSoundsEnabled()).resolves.toBe(false);
    expect(isSoundsEnabled()).toBe(false);
  });

  it("treats a malformed stored value as enabled", async () => {
    const { loadSoundsEnabled, isSoundsEnabled, setSoundsEnabled } =
      require("../preferences") as typeof Preferences;
    await setSoundsEnabled(false);
    secureStore().__store.set("kmcq_notification_sounds_enabled", "not-a-boolean");
    await expect(loadSoundsEnabled()).resolves.toBe(true);
    expect(isSoundsEnabled()).toBe(true);
  });

  it("keeps the in-memory value when writing storage fails", async () => {
    const { isSoundsEnabled, setSoundsEnabled } = require("../preferences") as typeof Preferences;
    secureStore().setItemAsync.mockRejectedValueOnce(new Error("write failed"));
    await expect(setSoundsEnabled(false)).resolves.toBeUndefined();
    expect(isSoundsEnabled()).toBe(false);
  });

  it("does not let an in-flight load overwrite a newer set", async () => {
    const { loadSoundsEnabled, isSoundsEnabled, setSoundsEnabled } =
      require("../preferences") as typeof Preferences;
    let resolveRead!: (value: string | null) => void;
    const pendingRead = new Promise<string | null>((resolve) => {
      resolveRead = resolve;
    });
    secureStore().getItemAsync.mockImplementationOnce(() => pendingRead);

    const loading = loadSoundsEnabled();
    await setSoundsEnabled(false);
    resolveRead("true");

    await expect(loading).resolves.toBe(false);
    expect(isSoundsEnabled()).toBe(false);
  });
});
