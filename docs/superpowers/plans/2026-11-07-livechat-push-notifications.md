# LiveChat Sound Alerts and Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable LiveChat sound alerts in the foreground and Expo Push notifications with sound in the background/terminated state, with per-admin mute, deep links, tests, and documentation.

**Architecture:** The server keeps the existing Web Push path and adds a separate Expo Push sender, token storage, and per-admin conversation mutes. The mobile app keeps polling as its foreground detector, adds an Expo Push token/observer layer, and funnels poll and push events through a message-ID watermark coordinator so each message rings once.

**Tech Stack:** Expo SDK 58 / React Native 0.88 / Expo Router / `expo-notifications` / `expo-audio` / Jest + `jest-expo`; Next.js 16 / Vitest / MySQL / `expo-server-sdk@^6.1.0`.

---

## Execution Constraints

- Mobile repo: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app`
- Server repo: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs`
- **Never** run `expo prebuild`, `expo run:android`, `expo run:ios`, EAS builds, or the Android environment-export/build commands. This plan is implemented with tests, typechecks, and dependency checks only.
- Use Node 20 for the server repo. Use Node 22 for mobile Expo/Jest commands:
  `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && <command>`
- The mobile working tree already contains unrelated `expo-audio` migration changes. Stage **only** the files named in each task.
- All code steps are TDD: write the failing test first, run it to see the expected failure, then implement.
- `expo-server-sdk` must stay on `^6.1.0`. Do not upgrade to v7/v8; they require Node `>=22.12.0`.
- No notification icon work in this plan. The default app icon is acceptable.
- No message text is ever placed in a push notification. Body is the visitor name only.

## File Map

### Server (`dev_app_nextjs`)

- Create `scripts/migration-add-livechat-mobile-push.sql` — token and mute tables.
- Modify `tests/helpers/db.ts` — apply migration, truncate new tables.
- Create `lib/livechat/mobile-push.ts` — token persistence, payload building, Expo Push sending.
- Create `app/api/mobile/livechat/push/register/route.ts` — authenticated token upsert.
- Create `app/api/mobile/livechat/push/unregister/route.ts` — authenticated token delete.
- Create `app/api/mobile/livechat/push/test/route.ts` — authenticated test notification.
- Modify `app/api/mobile/livechat/conversations/route.ts` — list `muted`.
- Modify `app/api/mobile/livechat/conversations/[id]/route.ts` — detail/PATCH `muted`.
- Modify `app/api/livechat/messages/route.ts` — fire-and-forget mobile push trigger.
- Create `tests/unit/livechat-mobile-push.test.ts` — push module unit tests.
- Create `tests/integration/livechat-mobile-push-migration.test.ts` — migration test.
- Create `tests/integration/mobile-livechat-push.test.ts` — token routes integration tests.
- Create `tests/integration/mobile-livechat-mute.test.ts` — conversation mute integration tests.
- Create `tests/integration/livechat-mobile-push-trigger.test.ts` — visitor-message trigger test.

### Mobile (`kmcq_admin_mobile_chat_app`)

- Modify `package.json`, `package-lock.json`, `app.json` — dependencies/plugin/test script.
- Create `jest.config.js` — Jest Expo preset.
- Create `assets/notification_sound/kmcq_gmbh_doorbell.wav` — underscore copy for Android raw resources.
- Create `src/lib/notifications/notificationData.ts` — pure payload parsing.
- Create `src/lib/notifications/pendingConversation.ts` — cold-start pending conversation.
- Create `src/lib/notifications/preferences.ts` — local sounds toggle.
- Create `src/lib/notifications/alertCoordinator.ts` — per-conversation watermark and dedupe.
- Create `src/lib/notifications/playAlertSound.ts` — shared audio player with fallback.
- Create `src/lib/notifications/push.types.ts` — shared test-notification result type.
- Create `src/lib/notifications/push.ts`, `push.web.ts` — permission/register/unregister.
- Create `src/lib/notifications/setup.ts`, `setup.web.ts` — handler/channel/observers.
- Create `src/lib/notifications/__tests__/*.test.ts` — Jest tests.
- Modify `src/app/_layout.tsx` — configure notifications and observers.
- Modify `src/app/index.tsx`, `src/app/login.tsx` — pending deep link + registration.
- Modify `src/app/livechat.tsx` — coordinator, mute, deep link, logout unregister.
- Modify `src/app/notification-sound.tsx` — permission, test notification, sounds toggle.
- Create `docs/notifications.md` — setup, limitations, test matrix.

---

### Task 1: Server migration and test database helper

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/scripts/migration-add-livechat-mobile-push.sql`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/tests/helpers/db.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/tests/integration/livechat-mobile-push-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/integration/livechat-mobile-push-migration.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { prepareTestDb } from "@/tests/helpers/db";
import { query } from "@/lib/db";

type Column = { name: string; type: string; nullable: string };

async function columns(table: string): Promise<Column[]> {
  return (await query(
    "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable " +
      "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  )) as Column[];
}

async function tableExists(table: string): Promise<boolean> {
  const rows = (await query(
    "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  )) as { c: number }[];
  return Number(rows[0]?.c) === 1;
}

async function indexColumns(table: string, index: string): Promise<string[]> {
  const rows = (await query(
    "SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX",
    [table, index],
  )) as { name: string }[];
  return rows.map((row) => row.name);
}

beforeAll(async () => {
  await prepareTestDb();
});

describe("mobile push migration", () => {
  it("creates the push token table with a unique token", async () => {
    expect(await tableExists("livechat_mobile_push_tokens")).toBe(true);
    const cols = await columns("livechat_mobile_push_tokens");
    expect(cols.find((c) => c.name === "admin_id")?.type).toBe("int");
    expect(cols.find((c) => c.name === "token")?.type).toBe("varchar(255)");
    expect(cols.find((c) => c.name === "platform")).toMatchObject({ type: "varchar(16)", nullable: "YES" });
    expect(await indexColumns("livechat_mobile_push_tokens", "uniq_mobile_push_token")).toEqual(["token"]);
  });

  it("creates the per-admin mute table with a composite key", async () => {
    expect(await tableExists("livechat_mobile_conversation_mutes")).toBe(true);
    expect(await indexColumns("livechat_mobile_conversation_mutes", "PRIMARY")).toEqual([
      "conversation_id",
      "admin_id",
    ]);

    const fk = (await query(
      "SELECT DELETE_RULE AS rule FROM information_schema.REFERENTIAL_CONSTRAINTS " +
        "WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_livechat_mobile_mute_conv'",
    )) as { rule: string }[];
    expect(fk[0]?.rule).toBe("CASCADE");
  });

  it("is idempotent when applied twice", async () => {
    await prepareTestDb();
    expect(await tableExists("livechat_mobile_push_tokens")).toBe(true);
    expect(await tableExists("livechat_mobile_conversation_mutes")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/integration/livechat-mobile-push-migration.test.ts
```

Expected: FAIL because `scripts/migration-add-livechat-mobile-push.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `scripts/migration-add-livechat-mobile-push.sql`:

```sql
-- Mobile Expo Push tokens and per-admin conversation mutes. Idempotent.

CREATE TABLE IF NOT EXISTS livechat_mobile_push_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  token VARCHAR(255) NOT NULL,
  platform VARCHAR(16) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_mobile_push_token (token),
  KEY idx_mobile_push_admin (admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS livechat_mobile_conversation_mutes (
  conversation_id BIGINT UNSIGNED NOT NULL,
  admin_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, admin_id),
  CONSTRAINT fk_livechat_mobile_mute_conv
    FOREIGN KEY (conversation_id) REFERENCES livechat_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 4: Apply the migration in the test helper**

Modify `tests/helpers/db.ts`. After the phase 6 block in `prepareTestDb()` add:

```ts
  const mobilePush = readFileSync(resolve("scripts/migration-add-livechat-mobile-push.sql"), "utf8");
  await admin.query(mobilePush);
```

In `resetTestDb()`, add these two TRUNCATEs **before** `TRUNCATE TABLE livechat_conversations`:

```ts
  await conn.query("TRUNCATE TABLE livechat_mobile_conversation_mutes");
  await conn.query("TRUNCATE TABLE livechat_mobile_push_tokens");
```

- [ ] **Step 5: Run the migration test**

Run:

```bash
npm test -- tests/integration/livechat-mobile-push-migration.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/migration-add-livechat-mobile-push.sql tests/helpers/db.ts tests/integration/livechat-mobile-push-migration.test.ts
git commit -m "test: add mobile push database migration"
```

---

### Task 2: Server mobile push module and unit tests

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/lib/livechat/mobile-push.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/tests/unit/livechat-mobile-push.test.ts`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/package.json`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/package-lock.json`

- [ ] **Step 1: Install the server SDK**

Run:

```bash
npm install expo-server-sdk@^6.1.0
```

Expected: `package.json` contains `"expo-server-sdk": "^6.1.0"`; `package-lock.json` updates.

- [ ] **Step 2: Write the failing unit tests**

Create `tests/unit/livechat-mobile-push.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  isExpoPushToken: vi.fn(),
  sendPushNotificationsAsync: vi.fn(),
  chunkPushNotifications: vi.fn(),
}));

vi.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken = sdk.isExpoPushToken;
    sendPushNotificationsAsync = sdk.sendPushNotificationsAsync;
    chunkPushNotifications = sdk.chunkPushNotifications;
  },
}));

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

const validToken = "ExponentPushToken[unit-test-token]";

let query: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  sdk.isExpoPushToken.mockReset();
  sdk.isExpoPushToken.mockImplementation(
    (value: unknown) =>
      typeof value === "string" &&
      (value.startsWith("ExponentPushToken[") || value.startsWith("ExpoPushToken[")) &&
      value.endsWith("]"),
  );
  sdk.sendPushNotificationsAsync.mockReset();
  sdk.sendPushNotificationsAsync.mockResolvedValue([]);
  sdk.chunkPushNotifications.mockReset();
  sdk.chunkPushNotifications.mockImplementation((messages: unknown[]) => [messages]);
  query = (await import("@/lib/db")).query as unknown as ReturnType<typeof vi.fn>;
  query.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("mobile push token validation and payload", () => {
  it("accepts Expo tokens and rejects malformed or oversized values", async () => {
    const { isValidMobilePushToken } = await import("@/lib/livechat/mobile-push");
    expect(isValidMobilePushToken(validToken)).toBe(true);
    expect(isValidMobilePushToken("not-a-token")).toBe(false);
    expect(isValidMobilePushToken(`ExponentPushToken[${"x".repeat(300)}]`)).toBe(false);
    expect(isValidMobilePushToken(null)).toBe(false);
  });

  it("builds a visitor-name-only message with routing metadata", async () => {
    const { buildMobilePushMessage } = await import("@/lib/livechat/mobile-push");
    expect(
      buildMobilePushMessage(validToken, { conversationId: 42, visitorName: "Anna Weber", messageId: 1001 }),
    ).toEqual({
      to: validToken,
      title: "New LiveChat message",
      body: "Anna Weber",
      data: { type: "livechat_message", conversationId: 42, messageId: 1001 },
      sound: "kmcq_gmbh_doorbell.wav",
      channelId: "livechat",
      priority: "high",
      collapseId: "livechat-conversation-42",
      tag: "livechat-conversation-42",
    });
  });
});

describe("sendMobileVisitorMessagePush", () => {
  it("queries only admins without a mute row for the conversation", async () => {
    query.mockResolvedValueOnce([{ id: 1, token: validToken }]);
    sdk.sendPushNotificationsAsync.mockResolvedValueOnce([{ status: "ok", id: "ticket-1" }]);
    const { sendMobileVisitorMessagePush } = await import("@/lib/livechat/mobile-push");

    const result = await sendMobileVisitorMessagePush({
      conversationId: 42,
      visitorName: "Anna Weber",
      messageId: 1001,
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("livechat_mobile_conversation_mutes"),
      [42],
    );
    expect(query.mock.calls[0][0]).toContain("NOT EXISTS");
    expect(result).toEqual({ sent: 1, pruned: 0, failed: 0, tokens: 1 });
  });

  it("prunes a token reported as DeviceNotRegistered", async () => {
    query.mockResolvedValueOnce([{ id: 1, token: validToken }]);
    query.mockResolvedValue([]);
    sdk.sendPushNotificationsAsync.mockResolvedValueOnce([
      { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
    ]);
    const { sendMobileVisitorMessagePush } = await import("@/lib/livechat/mobile-push");

    const result = await sendMobileVisitorMessagePush({
      conversationId: 42,
      visitorName: "Anna",
      messageId: 1001,
    });

    expect(result).toEqual({ sent: 0, pruned: 1, failed: 0, tokens: 1 });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("DELETE FROM livechat_mobile_push_tokens"),
      [validToken],
    );
  });

  it("keeps the token for a transient ticket error", async () => {
    query.mockResolvedValueOnce([{ id: 1, token: validToken }]);
    sdk.sendPushNotificationsAsync.mockResolvedValueOnce([
      { status: "error", message: "provider down", details: { error: "ProviderError" } },
    ]);
    const { sendMobileVisitorMessagePush } = await import("@/lib/livechat/mobile-push");

    const result = await sendMobileVisitorMessagePush({
      conversationId: 42,
      visitorName: "Anna",
      messageId: 1001,
    });

    expect(result).toEqual({ sent: 0, pruned: 0, failed: 1, tokens: 1 });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("DELETE"), expect.anything());
  });

  it("retries once on a 5xx request error", async () => {
    query.mockResolvedValueOnce([{ id: 1, token: validToken }]);
    const error = Object.assign(new Error("server down"), { statusCode: 500 });
    sdk.sendPushNotificationsAsync
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([{ status: "ok", id: "ticket-2" }]);
    const { sendMobileVisitorMessagePush } = await import("@/lib/livechat/mobile-push");

    const result = await sendMobileVisitorMessagePush({
      conversationId: 42,
      visitorName: "Anna",
      messageId: 1001,
    });

    expect(result).toEqual({ sent: 1, pruned: 0, failed: 0, tokens: 1 });
    expect(sdk.sendPushNotificationsAsync).toHaveBeenCalledTimes(2);
  });

  it("does not call Expo when there are no tokens", async () => {
    query.mockResolvedValueOnce([]);
    const { sendMobileVisitorMessagePush } = await import("@/lib/livechat/mobile-push");

    const result = await sendMobileVisitorMessagePush({
      conversationId: 42,
      visitorName: "Anna",
      messageId: 1001,
    });

    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0, tokens: 0 });
    expect(sdk.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it("never throws when the database read fails", async () => {
    query.mockRejectedValueOnce(new Error("db down"));
    const { sendMobileVisitorMessagePush } = await import("@/lib/livechat/mobile-push");

    await expect(
      sendMobileVisitorMessagePush({ conversationId: 42, visitorName: "Anna", messageId: 1001 }),
    ).resolves.toEqual({ sent: 0, pruned: 0, failed: 0, tokens: 0 });
  });

  it("logs counts and error codes, never tokens or visitor names", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    query.mockResolvedValueOnce([{ id: 1, token: validToken }]);
    sdk.sendPushNotificationsAsync.mockResolvedValueOnce([
      { status: "error", message: "provider down", details: { error: "ProviderError" } },
    ]);
    const { sendMobileVisitorMessagePush } = await import("@/lib/livechat/mobile-push");

    await sendMobileVisitorMessagePush({
      conversationId: 42,
      visitorName: "Secret Visitor",
      messageId: 1001,
    });

    const logged = log.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain(validToken);
    expect(logged).not.toContain("Secret Visitor");
    expect(logged).toContain("failed");
  });
});
```

- [ ] **Step 3: Run the unit tests to verify they fail**

Run:

```bash
npm test -- tests/unit/livechat-mobile-push.test.ts
```

Expected: FAIL because `lib/livechat/mobile-push.ts` does not exist.

- [ ] **Step 4: Implement the push module**

Create `lib/livechat/mobile-push.ts`:

```ts
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { query } from "@/lib/db";

export const MOBILE_PUSH_CHANNEL = "livechat";
export const MOBILE_PUSH_SOUND = "kmcq_gmbh_doorbell.wav";
export const MOBILE_PUSH_TITLE = "New LiveChat message";
export const MOBILE_PUSH_TEST_TITLE = "KMCQ LiveChat";
export const MOBILE_PUSH_TEST_BODY = "Test notification";

export type MobilePushInput = {
  conversationId: number;
  visitorName: string;
  messageId: number;
};

export type MobilePushResult = {
  sent: number;
  pruned: number;
  failed: number;
  tokens: number;
};

type TokenRow = { id: number; token: string };

const TOKEN_LIMIT = 255;

export function isValidMobilePushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= TOKEN_LIMIT &&
    Expo.isExpoPushToken(value)
  );
}

export async function saveMobilePushToken(
  adminId: number,
  token: string,
  platform: string | null,
): Promise<void> {
  await query(
    "INSERT INTO livechat_mobile_push_tokens (admin_id, token, platform) VALUES (?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE admin_id = VALUES(admin_id), platform = VALUES(platform)",
    [adminId, token, platform],
  );
}

export async function removeMobilePushToken(adminId: number, token: string): Promise<void> {
  await query("DELETE FROM livechat_mobile_push_tokens WHERE admin_id = ? AND token = ?", [adminId, token]);
}

export async function countMobilePushTokensForAdmin(adminId: number): Promise<number> {
  const rows = (await query(
    "SELECT COUNT(*) AS c FROM livechat_mobile_push_tokens WHERE admin_id = ?",
    [adminId],
  )) as unknown as { c: number }[];
  return Number(rows[0]?.c ?? 0);
}

export function buildMobilePushMessage(token: string, input: MobilePushInput): ExpoPushMessage {
  const tag = `livechat-conversation-${input.conversationId}`;
  return {
    to: token,
    title: MOBILE_PUSH_TITLE,
    body: input.visitorName,
    data: {
      type: "livechat_message",
      conversationId: input.conversationId,
      messageId: input.messageId,
    },
    sound: MOBILE_PUSH_SOUND,
    channelId: MOBILE_PUSH_CHANNEL,
    priority: "high",
    collapseId: tag,
    tag,
  };
}

function createExpo(): Expo {
  return new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
}

function isRetryableRequestError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 429 || (typeof statusCode === "number" && statusCode >= 500);
}

async function sendChunk(expo: Expo, chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  try {
    return await expo.sendPushNotificationsAsync(chunk);
  } catch (error) {
    if (!isRetryableRequestError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await expo.sendPushNotificationsAsync(chunk);
  }
}

function errorCode(error: unknown): string | number {
  if (typeof error !== "object" || error === null) return "unknown";
  const candidate = error as { code?: unknown; statusCode?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  return "unknown";
}

async function validTokensFromRows(rows: TokenRow[], result: MobilePushResult): Promise<string[]> {
  const valid: string[] = [];
  for (const row of rows) {
    if (isValidMobilePushToken(row.token)) {
      valid.push(row.token);
      continue;
    }
    result.pruned += 1;
    try {
      await query("DELETE FROM livechat_mobile_push_tokens WHERE token = ?", [row.token]);
    } catch {
      // Invalid rows are pruned best-effort; never log the token.
    }
  }
  return valid;
}

async function sendToTokens(
  tokens: string[],
  build: (token: string) => ExpoPushMessage,
  result: MobilePushResult,
): Promise<void> {
  if (tokens.length === 0) return;
  const expo = createExpo();
  const messages = tokens.map(build);
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await sendChunk(expo, chunk);
      tickets.forEach((ticket, index) => {
        if (ticket.status === "ok") {
          result.sent += 1;
          return;
        }

        const to = chunk[index]?.to;
        const token = typeof to === "string" ? to : null;
        if (ticket.details?.error === "DeviceNotRegistered" && token) {
          result.pruned += 1;
          void query("DELETE FROM livechat_mobile_push_tokens WHERE token = ?", [token]).catch(() => {});
          return;
        }
        result.failed += 1;
      });
    } catch (error) {
      result.failed += chunk.length;
      console.log("[LIVECHAT] Mobile push request failed", errorCode(error));
    }
  }
}

function logResult(result: MobilePushResult): void {
  if (result.failed === 0 && result.pruned === 0) return;
  console.log("[LIVECHAT] Mobile push complete", {
    sent: result.sent,
    pruned: result.pruned,
    failed: result.failed,
    tokens: result.tokens,
  });
}

export async function sendMobileVisitorMessagePush(input: MobilePushInput): Promise<MobilePushResult> {
  const result: MobilePushResult = { sent: 0, pruned: 0, failed: 0, tokens: 0 };
  try {
    const rows = (await query(
      "SELECT t.id, t.token FROM livechat_mobile_push_tokens t " +
        "WHERE NOT EXISTS (" +
        "SELECT 1 FROM livechat_mobile_conversation_mutes m " +
        "WHERE m.conversation_id = ? AND m.admin_id = t.admin_id" +
        ")",
      [input.conversationId],
    )) as unknown as TokenRow[];
    const tokenRows = Array.isArray(rows) ? rows : [];
    result.tokens = tokenRows.length;
    const tokens = await validTokensFromRows(tokenRows, result);
    await sendToTokens(tokens, (token) => buildMobilePushMessage(token, input), result);
  } catch (error) {
    console.log("[LIVECHAT] Mobile push failed", errorCode(error));
  }
  logResult(result);
  return result;
}

export async function sendTestMobilePush(adminId: number): Promise<MobilePushResult> {
  const result: MobilePushResult = { sent: 0, pruned: 0, failed: 0, tokens: 0 };
  try {
    const rows = (await query(
      "SELECT id, token FROM livechat_mobile_push_tokens WHERE admin_id = ?",
      [adminId],
    )) as unknown as TokenRow[];
    const tokenRows = Array.isArray(rows) ? rows : [];
    result.tokens = tokenRows.length;
    const tokens = await validTokensFromRows(tokenRows, result);
    await sendToTokens(
      tokens,
      (token) => ({
        to: token,
        title: MOBILE_PUSH_TEST_TITLE,
        body: MOBILE_PUSH_TEST_BODY,
        data: { type: "test" },
        sound: MOBILE_PUSH_SOUND,
        channelId: MOBILE_PUSH_CHANNEL,
        priority: "high",
      }),
      result,
    );
  } catch (error) {
    console.log("[LIVECHAT] Mobile test push failed", errorCode(error));
  }
  logResult(result);
  return result;
}
```

- [ ] **Step 5: Run the unit tests**

Run:

```bash
npm test -- tests/unit/livechat-mobile-push.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck the push module**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS. If `expo-server-sdk` cannot be resolved, verify the install from Step 1 and do not change the version.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/livechat/mobile-push.ts tests/unit/livechat-mobile-push.test.ts
git commit -m "feat: add server mobile push sender"
```

---

### Task 3: Server push API routes and integration tests

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/app/api/mobile/livechat/push/register/route.ts`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/app/api/mobile/livechat/push/unregister/route.ts`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/app/api/mobile/livechat/push/test/route.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/tests/integration/mobile-livechat-push.test.ts`

- [ ] **Step 1: Write the failing route integration test**

Create `tests/integration/mobile-livechat-push.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest } from "@/tests/helpers/request";
import { prepareTestDb, resetTestDb } from "@/tests/helpers/db";
import { query } from "@/lib/db";

type TestUser = { id: number; email: string; username: string };

const auth = vi.hoisted(() => ({ user: null as TestUser | null }));
const push = vi.hoisted(() => ({ sendTestMobilePush: vi.fn() }));

vi.mock("@/lib/livechat-mobile-auth", () => ({
  requireLivechatMobileAuth: async () => {
    if (!auth.user) throw new Error("Unauthorized");
    return { ...auth.user, scope: "livechat", aud: "mobile-livechat" };
  },
  getLivechatMobileAuth: async () => auth.user,
  verifyPassword: async () => true,
  hashPassword: async () => "hash",
  signLivechatToken: () => "token",
}));

vi.mock("@/lib/livechat/mobile-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/livechat/mobile-push")>();
  return { ...actual, sendTestMobilePush: push.sendTestMobilePush };
});

import { POST as register } from "@/app/api/mobile/livechat/push/register/route";
import { POST as unregister } from "@/app/api/mobile/livechat/push/unregister/route";
import { POST as sendTest } from "@/app/api/mobile/livechat/push/test/route";

const tokenA = "ExponentPushToken[admin-one]";
const tokenB = "ExponentPushToken[admin-two]";

function asUser(id: number): void {
  auth.user = { id, email: `admin${id}@kmcq-gmbh.com`, username: `admin${id}` };
}

async function tokensFor(adminId: number): Promise<{ token: string; platform: string | null }[]> {
  return (await query(
    "SELECT token, platform FROM livechat_mobile_push_tokens WHERE admin_id = ? ORDER BY token",
    [adminId],
  )) as { token: string; platform: string | null }[];
}

beforeAll(async () => {
  await prepareTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  asUser(1);
  push.sendTestMobilePush.mockReset();
  push.sendTestMobilePush.mockResolvedValue({ sent: 0, pruned: 0, failed: 0, tokens: 0 });
});

afterAll(async () => {
  await resetTestDb();
});

describe("mobile push token routes", () => {
  it("returns 401 when unauthenticated", async () => {
    auth.user = null;
    const res = await register(makeRequest({ method: "POST", body: { token: tokenA } }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400 and an invalid token with 422", async () => {
    const malformed = await register(makeRequest({ method: "POST", body: { token: 7 } }));
    expect(malformed.status).toBe(400);
    const invalid = await register(makeRequest({ method: "POST", body: { token: "not-a-token" } }));
    expect(invalid.status).toBe(422);
  });

  it("registers a token for the current admin", async () => {
    const res = await register(makeRequest({ method: "POST", body: { token: tokenA, platform: "ios" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await expect(tokensFor(1)).resolves.toEqual([{ token: tokenA, platform: "ios" }]);
  });

  it("keeps one row when the same admin registers the same token twice", async () => {
    await register(makeRequest({ method: "POST", body: { token: tokenA, platform: "ios" } }));
    await register(makeRequest({ method: "POST", body: { token: tokenA, platform: "android" } }));
    await expect(tokensFor(1)).resolves.toEqual([{ token: tokenA, platform: "android" }]);
  });

  it("reassigns a token to the latest admin", async () => {
    await register(makeRequest({ method: "POST", body: { token: tokenA, platform: "ios" } }));
    asUser(2);
    await register(makeRequest({ method: "POST", body: { token: tokenA, platform: "ios" } }));
    await expect(tokensFor(1)).resolves.toEqual([]);
    await expect(tokensFor(2)).resolves.toEqual([{ token: tokenA, platform: "ios" }]);
  });

  it("unregisters only the current admin's token", async () => {
    await query("INSERT INTO livechat_mobile_push_tokens (admin_id, token, platform) VALUES (?, ?, ?)", [
      1,
      tokenA,
      "ios",
    ]);
    await query("INSERT INTO livechat_mobile_push_tokens (admin_id, token, platform) VALUES (?, ?, ?)", [
      2,
      tokenB,
      "android",
    ]);

    const res = await unregister(makeRequest({ method: "POST", body: { token: tokenA } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await expect(tokensFor(1)).resolves.toEqual([]);
    await expect(tokensFor(2)).resolves.toEqual([{ token: tokenB, platform: "android" }]);
  });

  it("sends a test notification only to the current admin", async () => {
    push.sendTestMobilePush.mockResolvedValueOnce({ sent: 1, pruned: 0, failed: 0, tokens: 1 });
    const res = await sendTest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, failed: 0, tokens: 1 });
    expect(push.sendTestMobilePush).toHaveBeenCalledWith(1);
  });

  it("returns zero counts when the current admin has no tokens", async () => {
    const res = await sendTest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, failed: 0, tokens: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/integration/mobile-livechat-push.test.ts
```

Expected: FAIL because the three route files do not exist.

- [ ] **Step 3: Implement the register route**

Create `app/api/mobile/livechat/push/register/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireLivechatMobileAuth } from "@/lib/livechat-mobile-auth";
import { isValidMobilePushToken, saveMobilePushToken } from "@/lib/livechat/mobile-push";
import { readJson } from "@/lib/livechat/request";

export async function POST(req: NextRequest) {
  let userId: number;
  try {
    userId = (await requireLivechatMobileAuth()).id;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJson(req);
  if (body === null || typeof body.token !== "string") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const platform = body.platform === undefined ? null : body.platform;
  if (platform !== null && platform !== "ios" && platform !== "android") {
    return NextResponse.json({ error: "Invalid platform" }, { status: 422 });
  }
  if (!isValidMobilePushToken(body.token)) {
    return NextResponse.json({ error: "Invalid push token" }, { status: 422 });
  }

  await saveMobilePushToken(userId, body.token, platform);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Implement the unregister route**

Create `app/api/mobile/livechat/push/unregister/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireLivechatMobileAuth } from "@/lib/livechat-mobile-auth";
import { isValidMobilePushToken, removeMobilePushToken } from "@/lib/livechat/mobile-push";
import { readJson } from "@/lib/livechat/request";

export async function POST(req: NextRequest) {
  let userId: number;
  try {
    userId = (await requireLivechatMobileAuth()).id;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readJson(req);
  if (body === null || typeof body.token !== "string") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!isValidMobilePushToken(body.token)) {
    return NextResponse.json({ error: "Invalid push token" }, { status: 422 });
  }

  await removeMobilePushToken(userId, body.token);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Implement the test notification route**

Create `app/api/mobile/livechat/push/test/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireLivechatMobileAuth } from "@/lib/livechat-mobile-auth";
import { sendTestMobilePush } from "@/lib/livechat/mobile-push";

export async function POST() {
  let userId: number;
  try {
    userId = (await requireLivechatMobileAuth()).id;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendTestMobilePush(userId);
  return NextResponse.json({ sent: result.sent, failed: result.failed, tokens: result.tokens });
}
```

- [ ] **Step 6: Run the integration test**

Run:

```bash
npm test -- tests/integration/mobile-livechat-push.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add app/api/mobile/livechat/push tests/integration/mobile-livechat-push.test.ts
git commit -m "feat: add mobile push token API routes"
```

---

### Task 4: Server conversation mute support

**Files:**
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/app/api/mobile/livechat/conversations/route.ts`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/app/api/mobile/livechat/conversations/[id]/route.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/tests/integration/mobile-livechat-mute.test.ts`

- [ ] **Step 1: Write the failing mute integration test**

Create `tests/integration/mobile-livechat-mute.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ResultSetHeader } from "mysql2/promise";
import { makeRequest } from "@/tests/helpers/request";
import { prepareTestDb, resetTestDb } from "@/tests/helpers/db";
import { query } from "@/lib/db";

type TestUser = { id: number; email: string; username: string };

const auth = vi.hoisted(() => ({ user: null as TestUser | null }));

vi.mock("@/lib/livechat-mobile-auth", () => ({
  requireLivechatMobileAuth: async () => {
    if (!auth.user) throw new Error("Unauthorized");
    return { ...auth.user, scope: "livechat", aud: "mobile-livechat" };
  },
  getLivechatMobileAuth: async () => auth.user,
  verifyPassword: async () => true,
  hashPassword: async () => "hash",
  signLivechatToken: () => "token",
}));

import { GET as listConversations } from "@/app/api/mobile/livechat/conversations/route";
import {
  GET as getConversation,
  PATCH as patchConversation,
} from "@/app/api/mobile/livechat/conversations/[id]/route";

function asUser(id: number): void {
  auth.user = { id, email: `admin${id}@kmcq-gmbh.com`, username: `admin${id}` };
}

function context(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

async function createConversation(name = "Mute Test"): Promise<number> {
  const result = (await query(
    "INSERT INTO livechat_conversations (visitor_name, visitor_email, resume_token, status) VALUES (?, ?, ?, 'open')",
    [name, `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`, randomUUID()],
  )) as unknown as ResultSetHeader;
  return Number(result.insertId);
}

async function muteRows(conversationId: number): Promise<number> {
  const rows = (await query(
    "SELECT COUNT(*) AS c FROM livechat_mobile_conversation_mutes WHERE conversation_id = ?",
    [conversationId],
  )) as { c: number }[];
  return Number(rows[0]?.c ?? 0);
}

beforeAll(async () => {
  await prepareTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  asUser(1);
});

afterAll(async () => {
  await resetTestDb();
});

describe("mobile conversation mute", () => {
  it("returns 401 for an unauthenticated list request", async () => {
    auth.user = null;
    const res = await listConversations();
    expect(res.status).toBe(401);
  });

  it("mutes with a mute-only PATCH and returns the updated conversation", async () => {
    const id = await createConversation();

    const res = await patchConversation(
      makeRequest({ method: "PATCH", body: { muted: true } }),
      context(id),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, muted: true });
    expect(await muteRows(id)).toBe(1);
  });

  it("includes muted in the list for the muting admin only", async () => {
    const id = await createConversation();
    await patchConversation(makeRequest({ method: "PATCH", body: { muted: true } }), context(id));

    const mine = await (await listConversations()).json();
    expect(mine.find((c: { id: number }) => c.id === id)?.muted).toBe(true);

    asUser(2);
    const other = await (await listConversations()).json();
    expect(other.find((c: { id: number }) => c.id === id)?.muted).toBe(false);
  });

  it("includes muted in the detail for the muting admin only", async () => {
    const id = await createConversation();
    await patchConversation(makeRequest({ method: "PATCH", body: { muted: true } }), context(id));

    const mine = await getConversation(makeRequest(), context(id));
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ id, muted: true });

    asUser(2);
    const other = await getConversation(makeRequest(), context(id));
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ id, muted: false });
  });

  it("unmutes and removes the row", async () => {
    const id = await createConversation();
    await patchConversation(makeRequest({ method: "PATCH", body: { muted: true } }), context(id));

    const res = await patchConversation(
      makeRequest({ method: "PATCH", body: { muted: false } }),
      context(id),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, muted: false });
    expect(await muteRows(id)).toBe(0);
  });

  it("rejects a non-boolean muted value", async () => {
    const id = await createConversation();
    const res = await patchConversation(
      makeRequest({ method: "PATCH", body: { muted: "yes" } }),
      context(id),
    );
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/integration/mobile-livechat-mute.test.ts
```

Expected: FAIL because the conversation routes do not select or write `muted` yet.

- [ ] **Step 3: Add muted to the conversation list**

In `app/api/mobile/livechat/conversations/route.ts`, add `muted_count: number;` to `ListRow`.

Change the `unread_count` portion of `LIST_SQL` to add the mute subquery, keeping the unread subquery intact:

```ts
  `(SELECT COUNT(*) FROM livechat_messages m WHERE ${unreadPredicate("m", "r", "c")}) AS unread_count, ` +
  `(SELECT COUNT(*) FROM livechat_mobile_conversation_mutes mm WHERE mm.conversation_id = c.id AND mm.admin_id = ?) AS muted_count ` +
```

Change the query call to bind the admin ID twice, in placeholder order:

```ts
  const rows = (await query(LIST_SQL, [staleMinutes, staleMinutes, user.id, user.id])) as RowDataPacket[];
```

Add `muted` to each serialized conversation:

```ts
      muted: Number(c.muted_count) > 0,
```

- [ ] **Step 4: Add muted to conversation detail and PATCH**

In `app/api/mobile/livechat/conversations/[id]/route.ts`, add `muted_count: number;` to `ConvRow`.

Change `CONVERSATION_SQL` to include the admin-bound mute subquery:

```ts
const CONVERSATION_SQL =
  "SELECT c.id, c.status, c.visitor_name, c.visitor_email, c.assigned_agent_id, " +
  "a.name AS assigned_agent_name, c.created_at, c.last_activity_at, p.id AS predecessor_id, " +
  "(SELECT COUNT(*) FROM livechat_mobile_conversation_mutes mm " +
  "WHERE mm.conversation_id = c.id AND mm.admin_id = ?) AS muted_count " +
  "FROM livechat_conversations c " +
  "LEFT JOIN agents a ON a.id = c.assigned_agent_id " +
  "LEFT JOIN livechat_conversations p ON p.id = c.predecessor_id " +
  "WHERE c.id = ?";
```

Change `loadConversation` to accept the admin ID and bind it first:

```ts
async function loadConversation(id: number, adminId: number): Promise<ConvRow | null> {
  const rows = (await query(CONVERSATION_SQL, [adminId, id])) as RowDataPacket[];
  return (rows as unknown as ConvRow[])[0] ?? null;
}
```

Add `muted` to `serialize`:

```ts
    muted: Number(conv.muted_count) > 0,
```

Change `GET` to keep the user and pass the ID:

```ts
export async function GET(_req: NextRequest, ctx: Context) {
  const user = await requireLivechatMobileAuth();

  const id = parseNumericId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });

  const conv = await loadConversation(id, user.id);
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const msgs = (await query(MESSAGES_SQL, [id])) as RowDataPacket[];
  const messages = (msgs as unknown as MsgRow[]).map(serializeMessage);

  return NextResponse.json({ ...serialize(conv), messages });
}
```

Replace `PATCH` with this version, which validates mute before touching the row and still supports status/agent updates:

```ts
export async function PATCH(req: NextRequest, ctx: Context) {
  const user = await requireLivechatMobileAuth();

  const id = parseNumericId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });

  const body = await readJson(req);
  if (body === null) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const conv = await loadConversation(id, user.id);
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const sets: string[] = [];
  const params: unknown[] = [];
  let mutedChange: boolean | null = null;

  if (body.muted !== undefined) {
    if (typeof body.muted !== "boolean") {
      return NextResponse.json({ error: "Invalid muted value" }, { status: 422 });
    }
    mutedChange = body.muted;
  }

  if (body.status !== undefined) {
    if (body.status !== "open" && body.status !== "closed") {
      return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    }
    sets.push("status = ?");
    params.push(body.status);
    sets.push("closed_reason = ?");
    params.push(body.status === "closed" ? "admin" : null);
  }

  if (body.assignedAgentId !== undefined) {
    if (body.assignedAgentId === null) {
      sets.push("assigned_agent_id = NULL");
    } else {
      const agentId = Number(body.assignedAgentId);
      if (!Number.isInteger(agentId) || agentId <= 0) {
        return NextResponse.json({ error: "Invalid agent id" }, { status: 422 });
      }
      const found = (await query("SELECT id FROM agents WHERE id = ?", [agentId])) as RowDataPacket[];
      if (found.length === 0) return NextResponse.json({ error: "Agent not found" }, { status: 422 });
      sets.push("assigned_agent_id = ?");
      params.push(agentId);
    }
  }

  if (mutedChange === true) {
    await query(
      "INSERT IGNORE INTO livechat_mobile_conversation_mutes (conversation_id, admin_id) VALUES (?, ?)",
      [id, user.id],
    );
  } else if (mutedChange === false) {
    await query(
      "DELETE FROM livechat_mobile_conversation_mutes WHERE conversation_id = ? AND admin_id = ?",
      [id, user.id],
    );
  }

  if (sets.length > 0) {
    sets.push("last_activity_at = last_activity_at");
    await query(`UPDATE livechat_conversations SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }

  const updated = await loadConversation(id, user.id);
  if (!updated) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  return NextResponse.json(serialize(updated));
}
```

- [ ] **Step 5: Run the mute test**

Run:

```bash
npm test -- tests/integration/mobile-livechat-mute.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add "app/api/mobile/livechat/conversations/route.ts" "app/api/mobile/livechat/conversations/[id]/route.ts" tests/integration/mobile-livechat-mute.test.ts
git commit -m "feat: support per-admin conversation mute"
```

---

### Task 5: Trigger mobile push for visitor messages

**Files:**
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/app/api/livechat/messages/route.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs/tests/integration/livechat-mobile-push-trigger.test.ts`

- [ ] **Step 1: Write the failing trigger test**

Create `tests/integration/livechat-mobile-push-trigger.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createConversation } from "@/app/api/livechat/conversations/route";
import { POST as sendMessage } from "@/app/api/livechat/messages/route";
import { RESUME_COOKIE_NAME } from "@/lib/livechat/cookie";
import { dump, query } from "@/lib/db";
import { prepareTestDb, resetTestDb } from "@/tests/helpers/db";
import { makeRequest } from "@/tests/helpers/request";

const mobilePush = vi.hoisted(() => ({
  sendMobileVisitorMessagePush: vi.fn(),
}));

vi.mock("@/lib/livechat/mobile-push", () => ({
  sendMobileVisitorMessagePush: mobilePush.sendMobileVisitorMessagePush,
}));

async function newToken(ip: string): Promise<{ token: string; conversationId: number }> {
  const res = await createConversation(
    makeRequest({
      url: "http://localhost/api/livechat/conversations",
      method: "POST",
      body: { name: "Push Trigger", email: "push-trigger@example.com", clientNonce: "push-0-12345678" },
      ip,
    }),
  );
  const token = res.cookies.get(RESUME_COOKIE_NAME)?.value as string;
  const rows = (await query("SELECT id FROM livechat_conversations WHERE resume_token = ?", [token])) as {
    id: number;
  }[];
  return { token, conversationId: Number(rows[0].id) };
}

beforeAll(async () => {
  await prepareTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  await dump("INSERT INTO agents (name, status) VALUES ('Push Trigger Agent', 'online')");
  mobilePush.sendMobileVisitorMessagePush.mockReset();
  mobilePush.sendMobileVisitorMessagePush.mockResolvedValue({ sent: 0, pruned: 0, failed: 0, tokens: 0 });
});

afterAll(async () => {
  await resetTestDb();
});

describe("mobile push trigger", () => {
  it("uses the system greeting ID for the first visitor message", async () => {
    const { token, conversationId } = await newToken("198.51.100.71");
    const res = await sendMessage(
      makeRequest({
        url: "http://localhost/api/livechat/messages",
        method: "POST",
        body: { body: "First", clientNonce: "push-1-12345678" },
        token,
        ip: "198.51.100.71",
      }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.messages).toHaveLength(2);

    expect(mobilePush.sendMobileVisitorMessagePush).toHaveBeenCalledWith({
      conversationId,
      visitorName: "Push Trigger",
      messageId: data.messages[1].id,
    });
  });

  it("uses the visitor message ID for later messages", async () => {
    const { token, conversationId } = await newToken("198.51.100.72");
    await sendMessage(
      makeRequest({
        url: "http://localhost/api/livechat/messages",
        method: "POST",
        body: { body: "First", clientNonce: "push-2-12345678" },
        token,
        ip: "198.51.100.72",
      }),
    );
    mobilePush.sendMobileVisitorMessagePush.mockClear();

    const res = await sendMessage(
      makeRequest({
        url: "http://localhost/api/livechat/messages",
        method: "POST",
        body: { body: "Second", clientNonce: "push-3-12345678" },
        token,
        ip: "198.51.100.72",
      }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.messages).toHaveLength(1);
    expect(mobilePush.sendMobileVisitorMessagePush).toHaveBeenCalledWith({
      conversationId,
      visitorName: "Push Trigger",
      messageId: data.messages[0].id,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- tests/integration/livechat-mobile-push-trigger.test.ts
```

Expected: FAIL because the visitor-message route does not call `sendMobileVisitorMessagePush`.

- [ ] **Step 3: Add the fire-and-forget trigger**

In `app/api/livechat/messages/route.ts`, add the import:

```ts
import { sendMobileVisitorMessagePush } from "@/lib/livechat/mobile-push";
```

Immediately after the existing `sendVisitorMessagePush(...)` call and before the message re-query, add:

```ts
  void sendMobileVisitorMessagePush({
    conversationId: conv.id,
    visitorName: conv.visitor_name,
    messageId: systemId > 0 ? systemId : visitorId,
  }).catch(() => {});
```

The call must stay after `connection.commit()` and must not be awaited.

- [ ] **Step 4: Run the trigger test**

Run:

```bash
npm test -- tests/integration/livechat-mobile-push-trigger.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/livechat/messages/route.ts tests/integration/livechat-mobile-push-trigger.test.ts
git commit -m "feat: send mobile push for visitor messages"
```

---

### Task 6: Verify the complete server suite

**Files:** none.

- [ ] **Step 1: Run the full server tests**

Run:

```bash
npm test
```

Expected: PASS. No test may contact Expo; the unit test mocks the SDK and the trigger test mocks the mobile push module.

- [ ] **Step 2: Typecheck the server**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS, no output.

- [ ] **Step 3: Inspect for accidental content or token logging**

Run:

```bash
grep -R "console\.log.*token\|console\.log.*visitorName\|console\.log.*body" lib/livechat/mobile-push.ts app/api/mobile/livechat/push app/api/livechat/messages/route.ts
```

Expected: no matches.

- [ ] **Step 4: Commit any test-only correction if needed**

If the verification required a correction:

```bash
git add <only-the-corrected-files>
git commit -m "fix: correct mobile push server verification"
```

If no correction was needed, do not create an empty commit.

---

### Task 7: Mobile dependencies, app config, sound asset, and Jest

**Files:**
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/package.json`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/package-lock.json`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/app.json`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/jest.config.js`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/assets/notification_sound/kmcq_gmbh_doorbell.wav`

- [ ] **Step 1: Install the SDK-compatible notification package**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx expo install expo-notifications
```

Expected: `expo-notifications` is added to `dependencies` at the SDK 58 compatible range (`~58.1.8`).

- [ ] **Step 2: Install Jest**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx expo install --dev jest-expo jest @types/jest
```

Expected: `jest-expo`, `jest`, and `@types/jest` are added to `devDependencies`.

- [ ] **Step 3: Copy the underscore sound file**

Run:

```bash
cp assets/notification_sound/kmcq-gmbh-doorbell.wav assets/notification_sound/kmcq_gmbh_doorbell.wav
```

Expected: both WAV files exist. Android raw resource names cannot contain hyphens, so the underscore file is the one referenced by app config and the server payload.

- [ ] **Step 4: Add the Expo Notifications plugin**

In `app.json`, add this after the existing `"expo-asset"` plugin entry:

```json
      [
        "expo-notifications",
        {
          "defaultChannel": "livechat",
          "sounds": ["./assets/notification_sound/kmcq_gmbh_doorbell.wav"]
        }
      ]
```

Do not add `enableBackgroundRemoteNotifications`.

- [ ] **Step 5: Add the test script and Jest config**

In `package.json`, add to `scripts`:

```json
    "test": "jest",
```

Create `jest.config.js`:

```js
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/lib/notifications/__tests__/**/*.test.ts"],
};
```

- [ ] **Step 6: Verify Jest can start with no tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand --passWithNoTests
```

Expected: exit 0, "No tests found" is allowed only because of `--passWithNoTests`.

- [ ] **Step 7: Check dependency compatibility**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx expo install --check
```

Expected: all packages compatible.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.json jest.config.js assets/notification_sound/kmcq_gmbh_doorbell.wav
git commit -m "chore: configure Expo notifications and mobile tests"
```

---

### Task 8: Pure notification payload and pending-conversation modules

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/notificationData.ts`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/pendingConversation.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/__tests__/notificationData.test.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/__tests__/pendingConversation.test.ts`

- [ ] **Step 1: Write the failing notification-data tests**

Create `src/lib/notifications/__tests__/notificationData.test.ts`:

```ts
import { describe, expect, it } from "@jest/globals";
import { parseLivechatMessageData, parseTestNotificationData } from "../notificationData";

describe("parseLivechatMessageData", () => {
  it("accepts valid positive integer IDs", () => {
    expect(
      parseLivechatMessageData({ type: "livechat_message", conversationId: 42, messageId: 1001 }),
    ).toEqual({ conversationId: 42, messageId: 1001 });
  });

  it("rejects a different notification type", () => {
    expect(parseLivechatMessageData({ type: "test", conversationId: 42, messageId: 1001 })).toBeNull();
  });

  it("rejects missing, string, zero, negative, and non-integer IDs", () => {
    expect(parseLivechatMessageData({ type: "livechat_message", messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: "42", messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: 0, messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: -1, messageId: 1 })).toBeNull();
    expect(parseLivechatMessageData({ type: "livechat_message", conversationId: 1.5, messageId: 1 })).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseLivechatMessageData(null)).toBeNull();
    expect(parseLivechatMessageData(undefined)).toBeNull();
    expect(parseLivechatMessageData("livechat_message")).toBeNull();
  });
});

describe("parseTestNotificationData", () => {
  it("accepts the test type", () => {
    expect(parseTestNotificationData({ type: "test" })).toBe(true);
  });

  it("rejects other and missing types", () => {
    expect(parseTestNotificationData({ type: "livechat_message" })).toBe(false);
    expect(parseTestNotificationData({})).toBe(false);
    expect(parseTestNotificationData(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing pending-conversation tests**

Create `src/lib/notifications/__tests__/pendingConversation.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "@jest/globals";
import {
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
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand notificationData pendingConversation
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement notification-data parsing**

Create `src/lib/notifications/notificationData.ts`:

```ts
export type LivechatNotificationData = {
  conversationId: number;
  messageId: number;
};

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

export function parseLivechatMessageData(data: unknown): LivechatNotificationData | null {
  const record = asRecord(data);
  if (!record || record.type !== "livechat_message") return null;

  const conversationId = positiveInteger(record.conversationId);
  const messageId = positiveInteger(record.messageId);
  if (conversationId === null || messageId === null) return null;

  return { conversationId, messageId };
}

export function parseTestNotificationData(data: unknown): boolean {
  const record = asRecord(data);
  return record?.type === "test";
}
```

- [ ] **Step 5: Implement pending conversation storage**

Create `src/lib/notifications/pendingConversation.ts`:

```ts
let pendingConversationId: number | null = null;

export function setPendingConversationId(id: number): void {
  if (Number.isInteger(id) && id > 0) {
    pendingConversationId = id;
  }
}

export function consumePendingConversationId(): number | null {
  const id = pendingConversationId;
  pendingConversationId = null;
  return id;
}
```

- [ ] **Step 6: Run the tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand notificationData pendingConversation
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/notificationData.ts src/lib/notifications/pendingConversation.ts src/lib/notifications/__tests__/notificationData.test.ts src/lib/notifications/__tests__/pendingConversation.test.ts
git commit -m "feat: add notification payload parsing"
```

---

### Task 9: Local sounds preference and alert coordinator

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/preferences.ts`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/alertCoordinator.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/__tests__/preferences.test.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/__tests__/alertCoordinator.test.ts`

- [ ] **Step 1: Write the failing preference tests**

Create `src/lib/notifications/__tests__/preferences.test.ts`:

```ts
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

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
};

function secureStore(): SecureStoreMock {
  return jest.requireMock("expo-secure-store") as SecureStoreMock;
}

beforeEach(() => {
  jest.resetModules();
});

describe("sounds preference", () => {
  it("defaults to enabled when nothing is stored", async () => {
    const { loadSoundsEnabled, isSoundsEnabled } = await import("../preferences");
    await expect(loadSoundsEnabled()).resolves.toBe(true);
    expect(isSoundsEnabled()).toBe(true);
  });

  it("loads a stored false value", async () => {
    secureStore().__store.set("kmcq_notification_sounds_enabled", "false");
    const { loadSoundsEnabled, isSoundsEnabled } = await import("../preferences");
    await expect(loadSoundsEnabled()).resolves.toBe(false);
    expect(isSoundsEnabled()).toBe(false);
  });

  it("updates the cache and storage when changed", async () => {
    const { isSoundsEnabled, setSoundsEnabled } = await import("../preferences");
    await setSoundsEnabled(false);
    expect(isSoundsEnabled()).toBe(false);
    expect(secureStore().setItemAsync).toHaveBeenCalledWith("kmcq_notification_sounds_enabled", "false");
  });
});
```

- [ ] **Step 2: Write the failing coordinator tests**

Create `src/lib/notifications/__tests__/alertCoordinator.test.ts`:

```ts
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
    notifyNewMessage({ conversationId: 0, messageId: 1, sender: "visitor", muted: false });
    notifyNewMessage({ conversationId: 1, messageId: 0, sender: "visitor", muted: false });
    expect(playSound).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand preferences alertCoordinator
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the sounds preference**

Create `src/lib/notifications/preferences.ts`:

```ts
import * as SecureStore from "expo-secure-store";

const SOUNDS_ENABLED_KEY = "kmcq_notification_sounds_enabled";

let cachedSoundsEnabled = true;

export async function loadSoundsEnabled(): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(SOUNDS_ENABLED_KEY);
    cachedSoundsEnabled = stored === null ? true : stored === "true";
  } catch {
    cachedSoundsEnabled = true;
  }
  return cachedSoundsEnabled;
}

export function isSoundsEnabled(): boolean {
  return cachedSoundsEnabled;
}

export async function setSoundsEnabled(enabled: boolean): Promise<void> {
  cachedSoundsEnabled = enabled;
  try {
    await SecureStore.setItemAsync(SOUNDS_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // The in-memory value still applies for this session.
  }
}
```

- [ ] **Step 5: Implement the alert coordinator**

Create `src/lib/notifications/alertCoordinator.ts`:

```ts
import { isSoundsEnabled } from "./preferences";
import { playAlertSound } from "./playAlertSound";

type NewMessage = {
  conversationId: number;
  messageId: number;
  sender?: string | null;
  muted?: boolean;
};

const MAX_TRACKED_CONVERSATIONS = 500;
const watermarks = new Map<number, number>();

function validId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function trimWatermarks(): void {
  while (watermarks.size > MAX_TRACKED_CONVERSATIONS) {
    const oldest = watermarks.keys().next().value;
    if (oldest === undefined) return;
    watermarks.delete(oldest);
  }
}

export function seedConversation(conversationId: number, messageId: number): void {
  if (!validId(conversationId) || !validId(messageId)) return;
  const current = watermarks.get(conversationId) ?? 0;
  if (messageId <= current) return;
  watermarks.set(conversationId, messageId);
  trimWatermarks();
}

export function notifyNewMessage(message: NewMessage): void {
  const { conversationId, messageId } = message;
  if (!validId(conversationId) || !validId(messageId)) return;

  const current = watermarks.get(conversationId) ?? 0;
  if (messageId <= current) return;

  watermarks.set(conversationId, messageId);
  trimWatermarks();

  if (message.sender === "agent") return;
  if (message.muted) return;
  if (!isSoundsEnabled()) return;

  void playAlertSound();
}

export function resetAlertCoordinator(): void {
  watermarks.clear();
}
```

- [ ] **Step 6: Run the tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand preferences alertCoordinator
```

Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/preferences.ts src/lib/notifications/alertCoordinator.ts src/lib/notifications/__tests__/preferences.test.ts src/lib/notifications/__tests__/alertCoordinator.test.ts
git commit -m "feat: add sound preference and alert dedupe"
```

---

### Task 10: Shared foreground sound player

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/playAlertSound.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/__tests__/playAlertSound.test.ts`

- [ ] **Step 1: Write the failing player tests**

Create `src/lib/notifications/__tests__/playAlertSound.test.ts`:

```ts
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

function playerMock() {
  const subscription = { remove: jest.fn() };
  return {
    volume: 1,
    addListener: jest.fn(() => subscription),
    play: jest.fn(),
    remove: jest.fn(),
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand playAlertSound
```

Expected: FAIL because `src/lib/notifications/playAlertSound.ts` does not exist.

- [ ] **Step 3: Implement the player**

Create `src/lib/notifications/playAlertSound.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand playAlertSound
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/playAlertSound.ts src/lib/notifications/__tests__/playAlertSound.test.ts
git commit -m "feat: extract shared foreground alert player"
```

---

### Task 11: Expo push registration and notification response helpers

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/push.types.ts`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/push.ts`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/push.web.ts`
- Test: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/__tests__/push.test.ts`

- [ ] **Step 1: Write the failing push helper tests**

Create `src/lib/notifications/__tests__/push.test.ts`:

```ts
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: "test-project-id" } } },
    easConfig: null,
  },
}));
jest.mock("expo-device", () => ({ isDevice: jest.fn() }));
jest.mock("expo-notifications", () => ({
  PermissionStatus: { GRANTED: "granted" },
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addPushTokenListener: jest.fn(),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("../alertCoordinator", () => ({ notifyNewMessage: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("../../api", () => ({ __esModule: true, default: { post: jest.fn() } }));

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import api from "../../api";
import { notifyNewMessage } from "../alertCoordinator";
import { consumePendingConversationId } from "../pendingConversation";
import {
  configureNotifications,
  getNotificationPermission,
  handleNotificationReceived,
  handleNotificationResponse,
  registerForPushIfPermitted,
  registerForPushNotifications,
  requestNotificationPermission,
  sendTestMobilePush,
  unregisterForPushNotifications,
} from "../push";

const isDevice = jest.mocked(Device.isDevice);
const getPermissions = jest.mocked(Notifications.getPermissionsAsync);
const requestPermissions = jest.mocked(Notifications.requestPermissionsAsync);
const getToken = jest.mocked(Notifications.getExpoPushTokenAsync);
const setHandler = jest.mocked(Notifications.setNotificationHandler);
const post = jest.mocked(api.post);
const push = jest.mocked(router.push);
const alert = jest.mocked(notifyNewMessage);
const constants = Constants as unknown as { expoConfig: unknown; easConfig: unknown };

beforeEach(() => {
  jest.clearAllMocks();
  consumePendingConversationId();
  constants.expoConfig = { extra: { eas: { projectId: "test-project-id" } } };
  constants.easConfig = null;
  isDevice.mockReturnValue(true);
  getPermissions.mockResolvedValue({ granted: true, status: "granted" } as never);
  requestPermissions.mockResolvedValue({ granted: true, status: "granted" } as never);
  getToken.mockResolvedValue({ data: "ExponentPushToken[unit]" } as never);
  post.mockResolvedValue({ data: { ok: true } } as never);
});

describe("notification permission", () => {
  it("reports an existing grant without prompting", async () => {
    await expect(getNotificationPermission()).resolves.toBe("granted");
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it("reports denied when the OS will not ask again", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "denied",
      canAskAgain: false,
    } as never);
    await expect(getNotificationPermission()).resolves.toBe("denied");
  });

  it("requests permission and returns the result", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "undetermined",
      canAskAgain: true,
    } as never);
    requestPermissions.mockResolvedValueOnce({
      granted: true,
      status: "granted",
      canAskAgain: true,
    } as never);
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });
});

describe("registerForPushNotifications", () => {
  it("returns null on a simulator without requesting a token", async () => {
    isDevice.mockReturnValueOnce(false);
    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(getToken).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("returns null when permission is denied", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "denied",
      canAskAgain: false,
    } as never);
    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("registers the token with the server", async () => {
    await expect(registerForPushNotifications()).resolves.toBe("ExponentPushToken[unit]");
    expect(getToken).toHaveBeenCalledWith({ projectId: "test-project-id" });
    expect(post).toHaveBeenCalledWith("/api/mobile/livechat/push/register", {
      token: "ExponentPushToken[unit]",
      platform: Platform.OS === "android" ? "android" : "ios",
    });
  });

  it("returns null if server registration fails", async () => {
    post.mockRejectedValueOnce(new Error("offline"));
    await expect(registerForPushNotifications()).resolves.toBeNull();
  });

  it("returns null when the EAS project ID is missing", async () => {
    constants.expoConfig = { extra: {} };
    constants.easConfig = null;
    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("registerForPushIfPermitted", () => {
  it("never prompts when permission was already denied", async () => {
    getPermissions.mockResolvedValueOnce({
      granted: false,
      status: "denied",
      canAskAgain: false,
    } as never);
    await expect(registerForPushIfPermitted()).resolves.toBeNull();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("registers silently when permission is already granted", async () => {
    await expect(registerForPushIfPermitted()).resolves.toBe("ExponentPushToken[unit]");
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledTimes(1);
  });
});

describe("unregisterForPushNotifications", () => {
  it("posts the token and swallows failures", async () => {
    await unregisterForPushNotifications("ExponentPushToken[unit]");
    expect(post).toHaveBeenCalledWith("/api/mobile/livechat/push/unregister", {
      token: "ExponentPushToken[unit]",
    });
    post.mockRejectedValueOnce(new Error("offline"));
    await expect(unregisterForPushNotifications("ExponentPushToken[unit]")).resolves.toBeUndefined();
  });
});

describe("sendTestMobilePush", () => {
  it("returns the server result", async () => {
    post.mockResolvedValueOnce({ data: { sent: 1, failed: 0, tokens: 1 } } as never);
    await expect(sendTestMobilePush()).resolves.toEqual({ sent: 1, failed: 0, tokens: 1 });
  });
});

describe("configureNotifications", () => {
  it("suppresses real messages in the foreground and shows tests", async () => {
    await configureNotifications();
    expect(setHandler).toHaveBeenCalledTimes(1);
    const handler = setHandler.mock.calls[0][0] as {
      handleNotification: (notification: unknown) => Promise<{
        shouldShowBanner: boolean;
        shouldShowList: boolean;
        shouldPlaySound: boolean;
        shouldSetBadge: boolean;
      }>;
    };

    const livechat = {
      request: { content: { data: { type: "livechat_message", conversationId: 42, messageId: 99 } } },
    };
    await expect(handler.handleNotification(livechat)).resolves.toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });

    const test = { request: { content: { data: { type: "test" } } } };
    await expect(handler.handleNotification(test)).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
});

describe("handleNotificationResponse", () => {
  it("stores the conversation and routes to it", () => {
    handleNotificationResponse({
      notification: {
        request: {
          content: {
            data: { type: "livechat_message", conversationId: 42, messageId: 99 },
          },
        },
      },
    } as never);

    expect(consumePendingConversationId()).toBe(42);
    expect(push).toHaveBeenCalledWith({
      pathname: "/livechat",
      params: { conversationId: "42" },
    });
  });

  it("ignores malformed and unrelated data", () => {
    handleNotificationResponse({
      notification: { request: { content: { data: { type: "livechat_message", conversationId: "42" } } } },
    } as never);
    handleNotificationResponse(null);

    expect(consumePendingConversationId()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("handleNotificationReceived", () => {
  it("forwards a valid foreground message to the coordinator", () => {
    handleNotificationReceived({
      request: { content: { data: { type: "livechat_message", conversationId: 42, messageId: 99 } } },
    } as never);

    expect(alert).toHaveBeenCalledWith({
      conversationId: 42,
      messageId: 99,
      sender: "visitor",
      muted: false,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand push
```

Expected: FAIL because `src/lib/notifications/push.ts` does not exist.

- [ ] **Step 3: Define the token type**

Create `src/lib/notifications/push.types.ts`:

```ts
export type NotificationPermission = "granted" | "denied" | "undetermined" | "unsupported";

export type PushTestResult = {
  sent: number;
  failed: number;
  tokens: number;
};
```

- [ ] **Step 4: Implement the native push helpers**

Create `src/lib/notifications/push.ts`:

```ts
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import api from "../api";
import { notifyNewMessage } from "./alertCoordinator";
import { parseLivechatMessageData, parseTestNotificationData } from "./notificationData";
import { setPendingConversationId } from "./pendingConversation";
import type { NotificationPermission, PushTestResult } from "./push.types";

const PUSH_TOKEN_KEY = "kmcq_expo_push_token";
const CHANNEL_ID = "livechat";

function getProjectId(): string | null {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export async function configureNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const isTest = parseTestNotificationData(notification.request.content.data);
      return {
        shouldShowBanner: isTest,
        shouldShowList: isTest,
        shouldPlaySound: isTest,
        shouldSetBadge: false,
      };
    },
  });

  if (Platform.OS !== "android") return;

  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "LiveChat messages",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "kmcq_gmbh_doorbell.wav",
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      lightColor: "#27a343",
    });
  } catch {
    // The channel may already exist; it still uses the configured sound.
  }
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (permissions.granted) return "granted";
    return permissions.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    if (!current.canAskAgain) return "denied";

    const asked = await Notifications.requestPermissionsAsync();
    if (asked.granted) return "granted";
    return asked.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

async function registerDeviceToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;

    const projectId = getProjectId();
    if (!projectId) return null;

    const token = await Notifications.getExpoPushTokenAsync({ projectId });

    try {
      await api.post("/api/mobile/livechat/push/register", {
        token: token.data,
        platform: Platform.OS === "android" ? "android" : "ios",
      });
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token.data);
    } catch {
      return null;
    }

    return token.data;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  if ((await requestNotificationPermission()) !== "granted") return null;
  return registerDeviceToken();
}

export async function registerForPushIfPermitted(): Promise<string | null> {
  if ((await getNotificationPermission()) !== "granted") return null;
  return registerDeviceToken();
}

export async function unregisterForPushNotifications(explicitToken?: string): Promise<void> {
  try {
    const token = explicitToken ?? (await SecureStore.getItemAsync(PUSH_TOKEN_KEY));
    if (!token) return;

    try {
      await api.post("/api/mobile/livechat/push/unregister", { token });
    } catch {
      // Best effort. The server prunes tokens Expo reports as unregistered.
    }
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  } catch {
    // Never block logout on push cleanup.
  }
}

export async function sendTestMobilePush(): Promise<PushTestResult> {
  const res = await api.post<PushTestResult>("/api/mobile/livechat/push/test");
  return res.data;
}

export function handleNotificationReceived(notification: Notifications.Notification): void {
  const livechat = parseLivechatMessageData(notification.request.content.data);
  if (!livechat) return;

  notifyNewMessage({
    conversationId: livechat.conversationId,
    messageId: livechat.messageId,
    sender: "visitor",
    muted: false,
  });
}

export function handleNotificationResponse(
  response: Notifications.NotificationResponse | null,
  navigate = true,
): void {
  if (!response) return;

  const data = response.notification.request.content.data;
  const livechat = parseLivechatMessageData(data);
  if (livechat) {
    setPendingConversationId(livechat.conversationId);
    if (navigate) {
      router.push({
        pathname: "/livechat",
        params: { conversationId: String(livechat.conversationId) },
      });
    }
    return;
  }

  if (navigate && parseTestNotificationData(data)) {
    router.push("/notification-sound");
  }
}
```

- [ ] **Step 5: Implement the web fallbacks**

Create `src/lib/notifications/push.web.ts`:

```ts
import type { NotificationPermission, PushTestResult } from "./push.types";

export async function configureNotifications(): Promise<void> {}
export async function getNotificationPermission(): Promise<NotificationPermission> {
  return "unsupported";
}
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return "unsupported";
}
export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}
export async function registerForPushIfPermitted(): Promise<string | null> {
  return null;
}
export async function unregisterForPushNotifications(_token?: string): Promise<void> {}
export async function sendTestMobilePush(): Promise<PushTestResult> {
  return { sent: 0, failed: 0, tokens: 0 };
}
export function handleNotificationReceived(_notification: unknown): void {}
export function handleNotificationResponse(_response: unknown): void {}
```

- [ ] **Step 6: Run the push tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand push
```

Expected: PASS, 16 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/push.types.ts src/lib/notifications/push.ts src/lib/notifications/push.web.ts src/lib/notifications/__tests__/push.test.ts
git commit -m "feat: add Expo push registration helpers"
```

---

### Task 12: Notification setup and root layout wiring

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/setup.ts`
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/lib/notifications/setup.web.ts`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/app/_layout.tsx`

- [ ] **Step 1: Implement the native observers**

Create `src/lib/notifications/setup.ts`:

```ts
import * as Notifications from "expo-notifications";
import {
  configureNotifications,
  handleNotificationReceived,
  handleNotificationResponse,
  registerForPushIfPermitted,
} from "./push";
import { loadSoundsEnabled } from "./preferences";

export function initialiseNotifications(): () => void {
  void loadSoundsEnabled();
  void configureNotifications();

  const lastResponse = Notifications.getLastNotificationResponse();
  if (lastResponse) {
    handleNotificationResponse(lastResponse, false);
    Notifications.clearLastNotificationResponse();
  }

  const received = Notifications.addNotificationReceivedListener(handleNotificationReceived);
  const response = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
  let token: ReturnType<typeof Notifications.addPushTokenListener> | null = null;
  try {
    token = Notifications.addPushTokenListener(() => {
      void registerForPushIfPermitted();
    });
  } catch {
    // Some runtimes (for example Expo Go on Android) cannot observe token rollover.
  }

  return () => {
    received.remove();
    response.remove();
    token?.remove();
  };
}
```

- [ ] **Step 2: Implement the web no-op**

Create `src/lib/notifications/setup.web.ts`:

```ts
export function initialiseNotifications(): () => void {
  return () => {};
}
```

- [ ] **Step 3: Wire the layout**

Replace `src/app/_layout.tsx` with:

```tsx
import { useEffect } from "react";
import { Stack } from "expo-router";
import { initialiseNotifications } from "../lib/notifications/setup";

export default function RootLayout() {
  useEffect(() => initialiseNotifications(), []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="livechat" />
      <Stack.Screen name="agents" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="account-settings" />
      <Stack.Screen name="notification-sound" />
    </Stack>
  );
}
```

- [ ] **Step 4: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: only the pre-existing `src/components/app-tabs.web.tsx(38,6) TS2322` error remains.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/setup.ts src/lib/notifications/setup.web.ts src/app/_layout.tsx
git commit -m "feat: initialise notifications in the app root"
```

---

### Task 13: Register on startup and consume pending deep links

**Files:**
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/app/index.tsx`
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/app/login.tsx`

- [ ] **Step 1: Replace the startup screen**

Replace `src/app/index.tsx` with:

```tsx
import { useEffect } from "react";
import { router } from "expo-router";
import api from "../lib/api";
import { View, ActivityIndicator } from "react-native";
import { registerForPushIfPermitted } from "../lib/notifications/push";
import { consumePendingConversationId } from "../lib/notifications/pendingConversation";

export default function Index() {
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      await api.get("/api/mobile/livechat/auth/me");
    } catch {
      router.replace("/login");
      return;
    }

    void registerForPushIfPermitted().catch(() => {});

    const pending = consumePendingConversationId();
    if (pending) {
      router.replace({ pathname: "/livechat", params: { conversationId: String(pending) } });
    } else {
      router.replace("/livechat");
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#040f2d" }}>
      <ActivityIndicator size="large" color="#27a343" />
    </View>
  );
}
```

- [ ] **Step 2: Register after login and consume pending links**

In `src/app/login.tsx`, add these imports:

```ts
import { registerForPushIfPermitted } from "../lib/notifications/push";
import { consumePendingConversationId } from "../lib/notifications/pendingConversation";
```

Replace the success path of `login` with:

```ts
      await api.post("/api/mobile/livechat/auth/login", { email, username, password });
      void registerForPushIfPermitted().catch(() => {});
      const pending = consumePendingConversationId();
      if (pending) {
        router.replace({ pathname: "/livechat", params: { conversationId: String(pending) } });
      } else {
        router.replace("/livechat");
      }
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: only the pre-existing `src/components/app-tabs.web.tsx(38,6) TS2322` error remains.

- [ ] **Step 4: Commit**

```bash
git add src/app/index.tsx src/app/login.tsx
git commit -m "feat: register push tokens on startup and login"
```

---

### Task 14: Wire LiveChat to coordinator, mute, and deep links

**Files:**
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/app/livechat.tsx`

- [ ] **Step 1: Replace the imports**

Replace lines 1–7 with:

```tsx
import React, { useState, useEffect, useRef } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, AppState } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import api from "../lib/api";
import { notifyNewMessage, seedConversation } from "../lib/notifications/alertCoordinator";
import { consumePendingConversationId } from "../lib/notifications/pendingConversation";
import { registerForPushIfPermitted, unregisterForPushNotifications } from "../lib/notifications/push";
```

- [ ] **Step 2: Extend the conversation model**

Replace the `Conversation` interface with:

```ts
interface Conversation {
  id: number;
  visitorName: string;
  visitorEmail: string;
  lastMessagePreview?: string;
  lastMessageId?: number | null;
  lastMessageSender?: string | null;
  unreadCount?: number;
  status?: string;
  muted?: boolean;
}
```

- [ ] **Step 3: Replace the refs**

Replace lines 35–40 with:

```ts
  const flatListRef = useRef<FlatList>(null);
  const lastMessageIdRef = useRef<number>(0);
  const firstConversationLoadRef = useRef(true);
  const firstMessageLoadRef = useRef(true);
  const conversationsRef = useRef<Conversation[]>([]);
  const selectedConversationRef = useRef<number | null>(null);
  const handledParamRef = useRef<string | null>(null);
  const pushRegistrationAttemptedRef = useRef(false);
  const inFlightRef = useRef({ conversations: false, agents: false, messages: false });
  const retryTimeoutsRef = useRef<{ conversations?: any; agents?: any }>({});
  const params = useLocalSearchParams<{ conversationId?: string }>();
```

- [ ] **Step 4: Add the deep-link effect**

Insert immediately after the refs:

```ts
  useEffect(() => {
    const raw = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
    if (!raw || handledParamRef.current === raw) return;

    const id = Number(raw);
    if (loading || !Number.isInteger(id) || id <= 0) return;

    handledParamRef.current = raw;
    consumePendingConversationId();
    setSelectedConversation(id);
    router.setParams({ conversationId: undefined });
  }, [params.conversationId, loading]);
```

- [ ] **Step 4a: Register silently after a successful auth check**

Replace `checkAuth` with:

```ts
  const checkAuth = async () => {
    try {
      await api.get("/api/mobile/livechat/auth/me");
      if (!pushRegistrationAttemptedRef.current) {
        pushRegistrationAttemptedRef.current = true;
        void registerForPushIfPermitted();
      }
      return true;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        router.replace("/login");
        return false;
      }
      return false;
    }
  };
```

- [ ] **Step 5: Reset suppression flags when the app returns to the foreground**

In the existing `AppState` listener, insert these lines at the start of the `if (nextState === "active")` block:

```ts
      firstConversationLoadRef.current = true;
      firstMessageLoadRef.current = true;
      pushRegistrationAttemptedRef.current = false;
```

- [ ] **Step 6: Remove the old player cleanup**

In the main effect cleanup, delete:

```ts
      if (soundRef.current) {
        try {
          soundRef.current.remove();
        } catch {}
        soundRef.current = null;
      }
```

- [ ] **Step 7: Reset the detail suppression flag when switching conversations**

In the `selectedConversation` effect, replace both `lastMessageIdRef.current = 0;` lines with:

```ts
      lastMessageIdRef.current = 0;
      firstMessageLoadRef.current = true;
```

- [ ] **Step 8: Update the conversation list load**

Replace `loadConversations` with:

```ts
  const loadConversations = async () => {
    if (inFlightRef.current.conversations) return;
    inFlightRef.current.conversations = true;
    try {
      const res = await api.get("/api/mobile/livechat/conversations");
      const list: Conversation[] = Array.isArray(res.data) ? res.data : [];
      const first = firstConversationLoadRef.current;
      firstConversationLoadRef.current = false;

      for (const conversation of list) {
        if (!conversation.lastMessageId) continue;
        if (first) {
          seedConversation(conversation.id, conversation.lastMessageId);
        } else {
          notifyNewMessage({
            conversationId: conversation.id,
            messageId: conversation.lastMessageId,
            sender: conversation.lastMessageSender,
            muted: conversation.muted,
          });
        }
      }

      conversationsRef.current = list;
      setConversations(list);
      if (retryTimeoutsRef.current.conversations) {
        clearTimeout(retryTimeoutsRef.current.conversations);
        retryTimeoutsRef.current.conversations = undefined;
      }
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        router.replace("/login");
        return;
      }
      scheduleRetry("conversations", loadConversations);
    } finally {
      setLoading(false);
      inFlightRef.current.conversations = false;
    }
  };
```

- [ ] **Step 9: Delete the old sound player**

Delete the entire `playNotificationSound` function (lines 161–210 in the current file).

- [ ] **Step 10: Replace the message load sound logic**

Replace `loadMessages` with:

```ts
  const loadMessages = async (conversationId: number) => {
    if (inFlightRef.current.messages) return;
    inFlightRef.current.messages = true;
    try {
      const res = await api.get(`/api/mobile/livechat/conversations/${conversationId}`);
      const newMessages: Message[] = Array.isArray(res.data?.messages) ? res.data.messages : [];
      const latest = newMessages.length > 0 ? newMessages[newMessages.length - 1] : null;
      const latestId = latest?.id ?? 0;

      if (firstMessageLoadRef.current) {
        if (latestId > 0) seedConversation(conversationId, latestId);
        firstMessageLoadRef.current = false;
      } else if (latest && lastMessageIdRef.current > 0 && latestId > lastMessageIdRef.current) {
        notifyNewMessage({
          conversationId,
          messageId: latestId,
          sender: latest.sender,
          muted: conversationsRef.current.find((c) => c.id === conversationId)?.muted,
        });
      }

      lastMessageIdRef.current = latestId;
      setMessages((prev) => {
        if (prev.length === newMessages.length) {
          const same = prev.every((m, i) => m.id === newMessages[i]?.id && m.body === newMessages[i]?.body);
          if (same) return prev;
        }
        return newMessages;
      });
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        router.replace("/login");
        return;
      }
      if (status === 404) {
        setSelectedConversation(null);
        loadConversations();
        return;
      }
    } finally {
      inFlightRef.current.messages = false;
    }
  };
```

- [ ] **Step 11: Add the mute toggle**

Insert after `reopenConversation`:

```ts
  const toggleMute = async () => {
    if (!selectedConversation) return;
    const current = conversationsRef.current.find((c) => c.id === selectedConversation);
    const nextMuted = !current?.muted;
    try {
      await api.patch(`/api/mobile/livechat/conversations/${selectedConversation}`, {
        muted: nextMuted,
      });
      const updated = conversationsRef.current.map((c) =>
        c.id === selectedConversation ? { ...c, muted: nextMuted } : c,
      );
      conversationsRef.current = updated;
      setConversations(updated);
      loadConversations();
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to update mute");
    }
  };
```

- [ ] **Step 12: Unregister the push token on logout**

Replace `handleLogout` with:

```ts
  const handleLogout = async () => {
    try {
      await unregisterForPushNotifications();
    } catch {}
    try {
      await api.post("/api/mobile/livechat/auth/logout");
      router.replace("/login");
    } catch (error) {
      router.replace("/login");
    }
  };
```

- [ ] **Step 13: Show muted conversations in the list**

Inside `renderItem`, immediately after the `Closed` label block, add:

```tsx
                {item.muted && <Text style={{ fontSize: 12, color: "#666", marginTop: 2 }}>Muted</Text>}
```

- [ ] **Step 14: Add the mute button to the chat header**

In the detail header, replace the existing `Close` button with:

```tsx
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={toggleMute} style={styles.headerButton}>
              <Text style={styles.logoutText}>
                {conversationsRef.current.find((c) => c.id === selectedConversation)?.muted
                  ? "Unmute"
                  : "Mute"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={closeConversation} style={styles.headerButton}>
              <Text style={styles.logoutText}>Close</Text>
            </TouchableOpacity>
          </View>
```

Add this style next to `headerButton`:

```ts
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
```

- [ ] **Step 15: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: only the pre-existing `src/components/app-tabs.web.tsx(38,6) TS2322` error remains. The removed `soundRef`, `playNotificationSound`, `expo-audio`, and `customSound` references must not remain.

- [ ] **Step 16: Commit**

```bash
git add src/app/livechat.tsx
git commit -m "feat: dedupe alerts and add conversation mute"
```

---

### Task 15: Notification settings UI for permission, test, and sounds

**Files:**
- Modify: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/src/app/notification-sound.tsx`

- [ ] **Step 1: Update imports and state**

Replace line 1 with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
```

Replace line 3 with:

```tsx
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Switch, Linking } from "react-native";
```

Replace line 4 with:

```tsx
import { router, useFocusEffect } from "expo-router";
```

Add these imports after line 7:

```ts
import {
  getNotificationPermission,
  registerForPushNotifications,
  requestNotificationPermission,
  sendTestMobilePush,
} from "../lib/notifications/push";
import { loadSoundsEnabled, setSoundsEnabled } from "../lib/notifications/preferences";
import type { NotificationPermission } from "../lib/notifications/push.types";
```

Add these state values after `playing`:

```ts
  const [permission, setPermission] = useState<NotificationPermission>("undetermined");
  const [soundsEnabled, setSounds] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);
  const [testing, setTesting] = useState(false);
```

- [ ] **Step 2: Refresh permission state when the screen gains focus**

Insert after the existing `useEffect`:

```ts
  useFocusEffect(
    useCallback(() => {
      getNotificationPermission().then(setPermission).catch(() => {});
      loadSoundsEnabled().then(setSounds).catch(() => {});
    }, []),
  );
```

- [ ] **Step 3: Add permission, registration, test, and toggle handlers**

Insert after `resetToDefault`:

```ts
  const enablePush = async () => {
    setPushBusy(true);
    try {
      const status = await requestNotificationPermission();
      setPermission(status);
      if (status !== "granted") {
        Alert.alert("Notifications disabled", "Enable notifications in system settings.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const token = await registerForPushNotifications();
      Alert.alert(
        token ? "Push enabled" : "Push not enabled",
        token
          ? "This device can now receive LiveChat alerts."
          : "Could not register this device. Expo Go on Android cannot receive remote push; use a development build.",
      );
    } finally {
      setPushBusy(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const result = await sendTestMobilePush();
      Alert.alert(
        "Test notification",
        result.sent > 0
          ? `Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`
          : "No registered devices. Enable push first.",
      );
    } catch (err: any) {
      Alert.alert("Test failed", err.response?.data?.error || "Could not send test notification");
    } finally {
      setTesting(false);
    }
  };

  const toggleSounds = async (value: boolean) => {
    setSounds(value);
    await setSoundsEnabled(value);
  };
```

- [ ] **Step 4: Add the settings sections**

Inside the fragment after the existing current-sound section and before the choose-file button, add:

```tsx
            <View style={styles.section}>
              <Text style={styles.label}>Push notifications</Text>
              <Text style={styles.value}>
                {permission === "granted"
                  ? "Allowed"
                  : permission === "denied"
                    ? "Blocked in system settings"
                    : permission === "unsupported"
                      ? "Unsupported on this device"
                      : "Not enabled"}
              </Text>
              <Text style={styles.hint}>
                Background and closed-app alerts use Expo Push. Notifications never include message text.
              </Text>
              <TouchableOpacity style={styles.button} onPress={enablePush} disabled={pushBusy}>
                <Text style={styles.buttonText}>{pushBusy ? "Enabling..." : "Enable push notifications"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonSecondary} onPress={sendTest} disabled={testing}>
                <Text style={styles.buttonSecondaryText}>{testing ? "Sending..." : "Send test notification"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonSecondary} onPress={() => Linking.openSettings()}>
                <Text style={styles.buttonSecondaryText}>Open system settings</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <View style={styles.row}>
                <Text style={styles.label}>In-app sounds</Text>
                <Switch value={soundsEnabled} onValueChange={toggleSounds} />
              </View>
              <Text style={styles.hint}>
                This controls the foreground sound only. Android notification channel sounds are managed by the system.
              </Text>
            </View>
```

Add this style next to `section`:

```ts
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
```

- [ ] **Step 5: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: only the pre-existing `src/components/app-tabs.web.tsx(38,6) TS2322` error remains.

- [ ] **Step 6: Commit**

```bash
git add src/app/notification-sound.tsx
git commit -m "feat: add push permission and test controls"
```

---

### Task 16: Document the notification system

**Files:**
- Create: `/home/mike_q/Downloads/Apps/KMCQ GmbH/kmcq_admin_mobile_chat_app/docs/notifications.md`

- [ ] **Step 1: Write the operator and developer guide**

Create `docs/notifications.md`:

```md
# LiveChat notifications

## How alerts work

Foreground alerts are detected by the existing 5-second conversation poll and by Expo's
foreground notification listener. The app compares the newest message ID per
conversation with an in-memory watermark, then plays the shared doorbell once. The same
coordinator receives background push taps, so a message cannot ring twice even if the
push arrives at the same time as a poll. For real messages in the foreground the OS
banner is suppressed; only the in-app sound plays.

Background and terminated alerts use Expo Push. The server sends one notification to all
active tokens for an admin. It does not send another when the visitor's own client is in
the foreground, and it skips admins who muted the conversation.

Push payloads contain:

- title: `New LiveChat message`
- body: the visitor display name
- data: `{ "type": "livechat_message", "conversationId": 12, "messageId": 345 }`

The message body is never included in a push payload.

## Muting

Mute is per admin and per conversation. It is stored in
`livechat_mobile_conversation_mutes`. Muting suppresses both foreground and background
sound for that admin. Unread counts keep updating.

## Foreground sound

The foreground sound uses the custom file selected on the Notification Sound screen, then
falls back to the bundled `kmcq_gmbh_doorbell.mp3`. The separate "In-app sounds" switch
controls foreground playback only.

Android notification channel sound is fixed when the channel is created. If a user changes
the channel sound in Android system settings, reinstalling the app is the only way to
restore the channel default.

iOS background push sounds must be bundled files (`wav`, `caf`, or `aiff`). A user-picked
sound applies to foreground playback only; changing a remote push sound would require a
new app release.

## Server setup

Apply `scripts/migration-add-livechat-mobile-push.sql` before deploying the API changes.
The server uses `expo-server-sdk@^6.1.0`, which is the latest release compatible with the
production Node 20 runtime.

Production push delivery needs EAS project credentials:

1. Add the FCM V1 service account key in Expo under the Android credentials for this app.
2. Upload the APNs key or certificate for iOS.
3. Confirm the `extra.eas.projectId` in `app.json` matches the Expo project.

## Mobile setup

`expo-notifications` is configured through the app config plugin. The WAV used for remote
push is `assets/notification_sound/kmcq_gmbh_doorbell.wav`; the hyphenated MP3 remains the
foreground fallback. Android resource names cannot contain hyphens.

Registering a token happens after authentication on the startup screen and after a
successful login. Logout unregisters the device token.

## Verification

```bash
# mobile
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- --runInBand
npx tsc --noEmit
npx expo install --check
npx expo-doctor

# server
cd "/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs"
npm test
npx tsc --noEmit
```

Manual device checks:

1. Foreground with two conversations: one sound per new visitor message, no sound for agent replies.
2. Background: notification arrives from Expo Push and tapping opens the correct conversation.
3. Terminated: notification arrives and tapping opens the correct conversation after authentication.
4. Muted conversation: no sound in any state, unread count still increases.
5. Custom sound: foreground uses the picked file; background uses the bundled WAV.

Do not run EAS builds, prebuild, or native builds as part of this verification.
```

- [ ] **Step 2: Commit**

```bash
git add docs/notifications.md
git commit -m "docs: document LiveChat notification behavior"
```

---

### Task 17: Final verification

**Files:** none.

- [ ] **Step 1: Run all mobile unit tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- --runInBand
```

Expected: PASS. All notification unit tests run in the Node 22 environment.

- [ ] **Step 2: Typecheck mobile**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit
```

Expected: only the pre-existing `src/components/app-tabs.web.tsx(38,6) TS2322` error remains. Confirm no new errors mention notification files.

- [ ] **Step 3: Check Expo dependency compatibility**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx expo install --check
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx expo-doctor
```

Expected: no incompatible package warnings; `expo-doctor` passes or reports only pre-existing non-notification issues.

- [ ] **Step 4: Re-run the server suite**

Run:

```bash
cd "/home/mike_q/Downloads/Apps/KMCQ GmbH/dev_app_nextjs"
npm test
npx tsc --noEmit
```

Expected: PASS and no type errors.

- [ ] **Step 5: Review the final diff**

Run in both repositories:

```bash
git status
git diff --stat
```

Confirm:

- No visitor message body is written to server logs.
- No push token is logged.
- No `expo-av` import remains in mobile.
- No `soundRef` or `playNotificationSound` remains in `src/app/livechat.tsx`.
- The only sound filename used for remote push ends in `kmcq_gmbh_doorbell.wav`.

- [ ] **Step 6: Commit any final correction**

If verification required a correction:

```bash
git add <only-the-corrected-files>
git commit -m "fix: complete LiveChat push verification"
```

Do not create an empty commit.

