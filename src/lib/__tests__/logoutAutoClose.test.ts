import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  consumeLogoutClosePending,
  createLogoutAutoCloseController,
  isLogoutCloseParam,
  markLogoutClosePending,
} from "../logoutAutoClose";

describe("isLogoutCloseParam", () => {
  it("accepts the logout marker", () => {
    expect(isLogoutCloseParam("1")).toBe(true);
  });

  it("rejects missing and malformed markers", () => {
    expect(isLogoutCloseParam(undefined)).toBe(false);
    expect(isLogoutCloseParam(null)).toBe(false);
    expect(isLogoutCloseParam("0")).toBe(false);
    expect(isLogoutCloseParam("true")).toBe(false);
    expect(isLogoutCloseParam(["1"])).toBe(false);
    expect(isLogoutCloseParam([])).toBe(false);
  });
});

describe("logout close session marker", () => {
  it("is consumed only once", () => {
    expect(consumeLogoutClosePending()).toBe(false);

    markLogoutClosePending();

    expect(consumeLogoutClosePending()).toBe(true);
    expect(consumeLogoutClosePending()).toBe(false);
  });
});

describe("createLogoutAutoCloseController", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("exits on Android after 1800 ms", () => {
    const onExit = jest.fn();
    const controller = createLogoutAutoCloseController({ isAndroid: true, onExit });

    controller.arm();
    jest.advanceTimersByTime(1799);
    expect(onExit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("does not exit on non-Android platforms", () => {
    const onExit = jest.fn();
    const controller = createLogoutAutoCloseController({ isAndroid: false, onExit });

    controller.arm();
    jest.advanceTimersByTime(1800);

    expect(onExit).not.toHaveBeenCalled();
  });

  it("cancels a pending exit", () => {
    const onExit = jest.fn();
    const controller = createLogoutAutoCloseController({ isAndroid: true, onExit });

    controller.arm();
    controller.cancel();
    jest.advanceTimersByTime(1800);

    expect(onExit).not.toHaveBeenCalled();
  });

  it("does not create duplicate timers when armed twice", () => {
    const onExit = jest.fn();
    const controller = createLogoutAutoCloseController({ isAndroid: true, onExit });

    controller.arm();
    controller.arm();
    jest.advanceTimersByTime(1800);

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
