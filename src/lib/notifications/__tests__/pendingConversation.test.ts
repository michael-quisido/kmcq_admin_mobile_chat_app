import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  clearPendingConversationId,
  consumePendingConversationId,
  setPendingConversationId,
} from "../pendingConversation";

beforeEach(() => {
  consumePendingConversationId();
});

describe("pendingConversation", () => {
  it("returns a stored ID once and then clears it", () => {
    setPendingConversationId(42);
    expect(consumePendingConversationId()).toBe(42);
    expect(consumePendingConversationId()).toBeNull();
  });

  it("ignores invalid IDs", () => {
    setPendingConversationId(7);
    setPendingConversationId(Number.NaN);
    setPendingConversationId(0);
    setPendingConversationId(-3);
    setPendingConversationId(1.25);
    expect(consumePendingConversationId()).toBe(7);
    expect(consumePendingConversationId()).toBeNull();
  });

  it("clears a pending ID without returning it", () => {
    setPendingConversationId(42);
    clearPendingConversationId();
    expect(consumePendingConversationId()).toBeNull();
  });

  it("clears safely when nothing is pending", () => {
    clearPendingConversationId();
    expect(consumePendingConversationId()).toBeNull();
  });
});
