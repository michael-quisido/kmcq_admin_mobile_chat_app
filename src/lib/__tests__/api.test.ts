import { afterEach, describe, expect, it, jest } from "@jest/globals";

describe("API_BASE_URL", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    }
    jest.resetModules();
  });

  it("defaults to the production API", () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.resetModules();

    const { API_BASE_URL } = require("../api");

    expect(API_BASE_URL).toBe("http://10.209.252.88:3000");
  });

  it("uses EXPO_PUBLIC_API_URL when configured", () => {
    process.env.EXPO_PUBLIC_API_URL = "http://10.209.252.88:3000";
    jest.resetModules();

    const { API_BASE_URL } = require("../api");

    expect(API_BASE_URL).toBe("http://10.209.252.88:3000");
  });
});
