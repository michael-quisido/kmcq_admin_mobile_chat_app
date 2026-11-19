import { describe, expect, it } from "@jest/globals";

import { isLogoutCloseParam } from "../logoutAutoClose";

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
