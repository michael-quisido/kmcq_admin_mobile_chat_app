import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../preferences", () => ({ isSoundsEnabled: jest.fn(() => true) }));
jest.mock("../playAlertSound", () => ({ playAlertSound: jest.fn(() => Promise.resolve()) }));

import { isSoundsEnabled } from "../preferences";
import { playAlertSound } from "../playAlertSound";
import {
  notifyNewMessage,
  resetAlertCoordinator,
  seedConversation,
} from "../alertCoordinator";

const soundsEnabled = jest.mocked(isSoundsEnabled);
const playSound = jest.mocked(playAlertSound);

beforeEach(() => {
  resetAlertCoordinator();
  soundsEnabled.mockReturnValue(true);
  playSound.mockClear();
});

describe("alertCoordinator", () => {
  it("plays once for the first visitor message and ignores the same ID", () => {
    notifyNewMessage({ conversationId: 1, messageId: 10, sender: "visitor", muted: false });
    notifyNewMessage({ conversationId: 1, messageId: 10, sender: "visitor", muted: false });
    expect(playSound).toHaveBeenCalledTimes(1);
  });

  it("plays again for a higher message ID", () => {
    notifyNewMessage({ conversationId: 1, messageId: 10, sender: "visitor", muted: false });
    notifyNewMessage({ conversationId: 1, messageId: 11, sender: "visitor", muted: false });
    expect(playSound).toHaveBeenCalledTimes(2);
  });

  it("does not play for an agent message but advances the watermark", () => {
    notifyNewMessage({ conversationId: 1, messageId: 12, sender: "agent", muted: false });
    notifyNewMessage({ conversationId: 1, messageId: 12, sender: "visitor", muted: false });
    expect(playSound).not.toHaveBeenCalled();
  });

  it("does not play for a muted conversation but advances the watermark", () => {
    notifyNewMessage({ conversationId: 1, messageId: 13, sender: "visitor", muted: true });
    notifyNewMessage({ conversationId: 1, messageId: 13, sender: "visitor", muted: false });
    expect(playSound).not.toHaveBeenCalled();
  });

  it("does not play when sounds are disabled but advances the watermark", () => {
    soundsEnabled.mockReturnValue(false);
    notifyNewMessage({ conversationId: 1, messageId: 14, sender: "visitor", muted: false });
    soundsEnabled.mockReturnValue(true);
    notifyNewMessage({ conversationId: 1, messageId: 14, sender: "visitor", muted: false });
    expect(playSound).not.toHaveBeenCalled();
  });

  it("seeds history without sound", () => {
    seedConversation(1, 20);
    notifyNewMessage({ conversationId: 1, messageId: 19, sender: "visitor", muted: false });
    notifyNewMessage({ conversationId: 1, messageId: 21, sender: "visitor", muted: false });
    expect(playSound).toHaveBeenCalledTimes(1);
  });

  it("never lowers a watermark when seeded with an older ID", () => {
    seedConversation(1, 30);
    seedConversation(1, 20);
    notifyNewMessage({ conversationId: 1, messageId: 25, sender: "visitor", muted: false });
    expect(playSound).not.toHaveBeenCalled();
  });

  it("tracks conversations independently", () => {
    notifyNewMessage({ conversationId: 1, messageId: 10, sender: "visitor", muted: false });
    notifyNewMessage({ conversationId: 2, messageId: 10, sender: "visitor", muted: false });
    expect(playSound).toHaveBeenCalledTimes(2);
  });

  it("ignores invalid IDs", () => {
    const invalidIds = [0, -1, 1.5, Number.NaN];
    for (const conversationId of invalidIds) {
      notifyNewMessage({ conversationId, messageId: 1, sender: "visitor", muted: false });
    }
    for (const messageId of invalidIds) {
      notifyNewMessage({ conversationId: 1, messageId, sender: "visitor", muted: false });
    }
    expect(playSound).not.toHaveBeenCalled();
  });

  it("evicts the least recently updated conversation", () => {
    for (let conversationId = 1; conversationId <= 500; conversationId += 1) {
      notifyNewMessage({ conversationId, messageId: 1, sender: "agent", muted: false });
    }

    notifyNewMessage({ conversationId: 1, messageId: 2, sender: "agent", muted: false });
    notifyNewMessage({ conversationId: 501, messageId: 1, sender: "agent", muted: false });

    notifyNewMessage({ conversationId: 2, messageId: 1, sender: "visitor", muted: false });
    expect(playSound).toHaveBeenCalledTimes(1);

    notifyNewMessage({ conversationId: 1, messageId: 2, sender: "visitor", muted: false });
    expect(playSound).toHaveBeenCalledTimes(1);
  });
});
