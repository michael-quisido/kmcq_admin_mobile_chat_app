import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-notifications", () => ({
  getLastNotificationResponse: jest.fn(),
  clearLastNotificationResponse: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addPushTokenListener: jest.fn(),
}));
jest.mock("../push", () => ({
  configureNotifications: jest.fn(),
  handleNotificationReceived: jest.fn(),
  handleNotificationResponse: jest.fn(),
  registerForPushIfPermitted: jest.fn(),
}));
jest.mock("../preferences", () => ({
  loadSoundsEnabled: jest.fn(),
}));

import * as Notifications from "expo-notifications";
import {
  configureNotifications,
  handleNotificationReceived,
  handleNotificationResponse,
  registerForPushIfPermitted,
} from "../push";
import { loadSoundsEnabled } from "../preferences";
import { initialiseNotifications } from "../setup";

const getLastResponse = jest.mocked(Notifications.getLastNotificationResponse);
const clearLastResponse = jest.mocked(Notifications.clearLastNotificationResponse);
const addReceivedListener = jest.mocked(Notifications.addNotificationReceivedListener);
const addResponseListener = jest.mocked(Notifications.addNotificationResponseReceivedListener);
const addTokenListener = jest.mocked(Notifications.addPushTokenListener);
const configure = jest.mocked(configureNotifications);
const loadSounds = jest.mocked(loadSoundsEnabled);
const handleReceived = jest.mocked(handleNotificationReceived);
const handleResponse = jest.mocked(handleNotificationResponse);
const registerIfPermitted = jest.mocked(registerForPushIfPermitted);

type ResponseListener = Parameters<typeof Notifications.addNotificationResponseReceivedListener>[0];
type TokenListener = Parameters<typeof Notifications.addPushTokenListener>[0];

let responseListener: ResponseListener | null = null;
let tokenListener: TokenListener | null = null;

function subscription() {
  return { remove: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  responseListener = null;
  tokenListener = null;
  getLastResponse.mockReturnValue(null);
  configure.mockResolvedValue(undefined);
  loadSounds.mockResolvedValue(true);
  addReceivedListener.mockReturnValue(subscription() as never);
  addResponseListener.mockImplementation((listener) => {
    responseListener = listener;
    return subscription() as never;
  });
  addTokenListener.mockImplementation((listener) => {
    tokenListener = listener;
    return subscription() as never;
  });
});

describe("initialiseNotifications", () => {
  it("loads preferences, configures notifications, registers listeners, and cleans up", () => {
    const received = subscription();
    const response = subscription();
    const token = subscription();
    addReceivedListener.mockReturnValue(received as never);
    addResponseListener.mockReturnValue(response as never);
    addTokenListener.mockReturnValue(token as never);

    const cleanup = initialiseNotifications();

    expect(loadSounds).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledTimes(1);
    expect(addReceivedListener).toHaveBeenCalledWith(handleReceived);
    expect(addResponseListener).toHaveBeenCalledTimes(1);
    expect(addTokenListener).toHaveBeenCalledTimes(1);

    cleanup();

    expect(received.remove).toHaveBeenCalledTimes(1);
    expect(response.remove).toHaveBeenCalledTimes(1);
    expect(token.remove).toHaveBeenCalledTimes(1);
  });

  it("handles and clears a last response present at startup", () => {
    const lastResponse = { notification: {} } as never;
    getLastResponse.mockReturnValue(lastResponse);

    initialiseNotifications();

    expect(handleResponse).toHaveBeenCalledWith(lastResponse, false);
    expect(clearLastResponse).toHaveBeenCalledTimes(1);
  });

  it("handles a live response and clears the last response", () => {
    initialiseNotifications();
    const liveResponse = { notification: {} } as never;

    responseListener!(liveResponse);

    expect(handleResponse).toHaveBeenCalledWith(liveResponse);
    expect(clearLastResponse).toHaveBeenCalledTimes(1);
  });

  it("survives a push token observer that throws", () => {
    addTokenListener.mockImplementation(() => {
      throw new Error("unavailable");
    });

    let cleanup: (() => void) | undefined;
    expect(() => {
      cleanup = initialiseNotifications();
    }).not.toThrow();
    expect(() => cleanup?.()).not.toThrow();
  });

  it("re-registers push when the token rolls over", () => {
    initialiseNotifications();

    tokenListener!({} as never);

    expect(registerIfPermitted).toHaveBeenCalledTimes(1);
  });

  it("survives an unavailable last notification response", () => {
    getLastResponse.mockImplementation(() => {
      throw new Error("unavailable");
    });

    expect(() => initialiseNotifications()).not.toThrow();
    expect(addReceivedListener).toHaveBeenCalledTimes(1);
    expect(addResponseListener).toHaveBeenCalledTimes(1);
    expect(addTokenListener).toHaveBeenCalledTimes(1);
  });
});
