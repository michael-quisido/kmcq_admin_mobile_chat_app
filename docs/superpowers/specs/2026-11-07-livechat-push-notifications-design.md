# LiveChat Sound Alerts and Push Notifications — Design

- **Date:** 2026-11-07
- **Status:** Approved
- **Mobile repo:** `kmcq_admin_mobile_chat_app`
- **Server repo:** `dev_app_nextjs`
- **Approach:** A — polling remains the foreground detector; Expo Push handles background/terminated delivery.

## 1. Problem

The mobile admin app currently plays a doorbell only when the selected conversation is open and the 2-second message poll detects a new visitor/system message. There is no notification mechanism when the app is backgrounded or terminated, and no mute or sound preference.

The server already has Web Push/VAPID for the Next.js admin inbox, but Web Push cannot deliver to the native React Native app. The mobile app has no push token registration, no notification permission flow, and no server-side mobile push sender.

## 2. Goals

- Play the existing in-app sound for new chat messages while the app is foregrounded, unless the conversation is muted or the local sounds toggle is off.
- Deliver OS push notifications with sound when the app is backgrounded or terminated.
- Suppress foreground/background alerts for muted conversations and for the admin's own agent replies.
- Avoid duplicate sounds when push and polling detect the same message.
- Support per-admin conversation mute, stored server-side so terminated-state pushes can be suppressed.
- Open the correct conversation when a notification is tapped, including cold starts and expired sessions.
- Handle denied notification permission, missing push tokens, offline delivery, simulator/Expo Go/web, and missing server credentials gracefully.
- Keep Expo/FCM/APNs credentials and push-provider secrets on the server/EAS; never embed them in the app.
- Keep notification content minimal: no message body on the lock screen.
- Never log push tokens or message contents.
- Add automated tests and clear setup/limitations documentation.
- Make the smallest appropriate change; no large navigation or polling refactor.

## 3. Non-goals

- No global root-level polling provider (approach C).
- No push-first foreground replacement of polling (approach B).
- No message-preview text in push notifications.
- No push for agent replies or the admin's own messages.
- No push receipt polling/cron; immediate push-ticket errors are handled.
- No custom user-picked sound for background push; the bundled doorbell is used.
- No native build, prebuild, or EAS build in this effort.

## 4. Current-state findings

### Mobile app

- Expo SDK 58 (`expo ~58.0.23`, React Native 0.88.1), Expo Router, EAS project ID `52a742b9-d63c-4bbb-9cd7-50bb0fcfa2b2`.
- `src/app/livechat.tsx` polls conversations/agents every 5 seconds and the selected conversation messages every 2 seconds. It plays `assets/notification_sound/kmcq-gmbh-doorbell.mp3` through `expo-audio`.
- The current alert only fires for the selected conversation; the conversations list is not used to detect arrivals in other conversations.
- `src/app/notification-sound.tsx` lets the admin pick a custom in-app sound stored in private storage via `src/lib/notifications/customSound.ts`.
- No `expo-notifications`, no push token, no push registration, no mute, and no sounds-enabled toggle.
- `expo-constants`, `expo-linking`, `expo-secure-store`, `expo-device`, and `expo-audio` are already dependencies.
- No test runner is configured; `__tests__/notifications/` exists but is empty.
- `android/` and `ios/` are generated/ignored; never edit them by hand.

### Server

- Next.js app with cookie-based mobile JWT auth (`lib/livechat-mobile-auth.ts`).
- Existing push is Web Push/VAPID only (`lib/livechat/push.ts`, `livechat_push_subscriptions`), used by the web admin inbox.
- Visitor messages are inserted in `app/api/livechat/messages/route.ts`; the route already triggers the Web Push sender fire-and-forget.
- Mobile conversation APIs:
  - `GET /api/mobile/livechat/conversations`
  - `GET/PATCH /api/mobile/livechat/conversations/:id`
  - `POST /api/mobile/livechat/conversations/:id/read`
- Per-admin read state already exists in `livechat_conversation_reads`.
- Test framework is Vitest; `tests/helpers/db.ts` applies the livechat migrations and truncates tables.

## 5. Decisions

| Decision | Choice |
|---|---|
| Push transport | Expo Push Service (`expo-notifications` client, `expo-server-sdk` server). EAS holds FCM V1/APNs credentials. |
| Backend scope | Modify `dev_app_nextjs` in this effort. |
| Mute model | Per-admin (`conversation_id`, `admin_id`), consistent with per-admin read state. |
| Notification content | Title `New LiveChat message`; body = visitor name only; no message text. |
| Sounds preference | Local per-device in SecureStore; applies to foreground in-app sound. Background sound remains OS/channel-controlled. |
| Foreground source | Existing polls plus push listener, deduped by message ID. |
| Permission prompting | Explicit user action only; no automatic prompt on launch. |
| Sound for push | Bundled `kmcq_gmbh_doorbell.wav`. User-picked sound is foreground-only. |

## 6. Architecture

```text
Visitor sends message
  └─ POST /api/livechat/messages (server commits message)
       ├─ Web Push (existing, unchanged)
       └─ Mobile Push (new, fire-and-forget)
            ├─ query device tokens whose admin has NOT muted the conversation
            ├─ Expo Push Service → FCM/APNs
            └─ device shows OS notification with channel sound (background/terminated)

App foreground
  ├─ conversations poll (5s) ─┐
  ├─ selected message poll (2s) ├─> alertCoordinator (dedupe by conversationId + messageId)
  └─ push received listener ──┘        ├─ skip agent messages
                                        ├─ skip muted conversations
                                        ├─ skip if local sounds disabled
                                        └─ play in-app sound

Notification tap
  └─ response listener → /livechat?conversationId=... (pending across login/cold start)
```

## 7. Mobile design

### 7.1 Dependency and app config

- Install with `npx expo install expo-notifications` (SDK-compatible version; docs list `~58.1.8`).
- Add `expo-notifications` to `app.json` plugins:

```json
[
  "expo-notifications",
  {
    "defaultChannel": "livechat",
    "sounds": ["./assets/notification_sound/kmcq_gmbh_doorbell.wav"]
  }
]
```

- Do not set `enableBackgroundRemoteNotifications`; this feature uses user-visible notifications, not data-only background tasks.
- Do not add a notification icon in this change; the default app icon is acceptable. A future 96x96 all-white transparent icon can be added.
- Add `assets/notification_sound/kmcq_gmbh_doorbell.wav` (underscores) by copying the existing `kmcq-gmbh-doorbell.wav`. Android raw resource names cannot contain hyphens. Keep the existing MP3 for in-app foreground playback; the original hyphenated WAV may be removed once the copy is verified.

### 7.2 Notification modules

Create `src/lib/notifications/`:

- **`setup.ts`** (native):
  - `configureNotifications()`:
    - Calls `setNotificationHandler`:
      - Real message (`data.type === "livechat_message"`): `shouldShowBanner: false`, `shouldShowList: false`, `shouldPlaySound: false`, `shouldSetBadge: false`.
      - Test notification (`data.type === "test"`): show/sound so the server path can be verified while foregrounded.
    - On Android, `setNotificationChannelAsync("livechat", { name: "LiveChat messages", importance: HIGH, sound: "kmcq_gmbh_doorbell.wav", vibrationPattern, lightColor })`.
    - Loads the local sounds preference.
  - `useNotificationObserver()`:
    - `addNotificationReceivedListener`: for `livechat_message`, call the alert coordinator with `conversationId`, `messageId`, `sender` (default visitor), `muted: false` (the server does not send muted conversations).
    - `addNotificationResponseReceivedListener`: for a default tap action, extract/validate `conversationId`, set pending, navigate to `/livechat?conversationId=...`.
    - Cold start: `getLastNotificationResponse()` then `clearLastNotificationResponse()`.
    - `addPushTokenListener`: re-register the new token when the OS rolls it.
    - Return an effect cleanup that removes every subscription.
  - Use `notificationData.ts` for all payload parsing so parsing is unit-testable without importing native modules.
- **`notificationData.ts`**:
  - `parseLivechatMessageData(data)` returns `{ conversationId, messageId }` only when `data.type === "livechat_message"` and both IDs are positive integers; otherwise `null`.
  - `parseTestNotificationData(data)` returns true when `data.type === "test"`.
- **`setup.web.ts`**: no-op exports so web bundling does not import `expo-notifications`.
- **`push.ts`** (native):
  - `getNotificationPermission()` returns `granted | denied | undetermined | unsupported`.
  - `requestNotificationPermission()` calls `requestPermissionsAsync`; interprets iOS `ios.status` (`AUTHORIZED`, `PROVISIONAL`, `EPHEMERAL`) and Android top-level status.
  - `getProjectId()` from `Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId`.
  - `registerForPushNotifications()`:
    - Guard `Platform.OS === "web"` and `Device.isDevice` (simulators show a clear message; return unsupported).
    - Check permission without prompting; if not granted, return `permission_denied`/`undetermined`.
    - `getExpoPushTokenAsync({ projectId })`; catch offline/config errors.
    - Store the token locally (SecureStore key `kmcq_expo_push_token`).
    - `POST /api/mobile/livechat/push/register` with `{ token, platform: Platform.OS }`.
  - `registerForPushIfPermitted()`: silent app-start/login path; only checks existing permission, never prompts.
  - `unregisterForPushNotifications()`: `POST /api/mobile/livechat/push/unregister` with the stored token, then clear local storage. Called before logout; failures are swallowed.
  - Never display or log the raw token.
- **`push.web.ts`**: no-op functions with the same exported names.
- **`preferences.ts`**:
  - SecureStore key `kmcq_notification_sounds_enabled`, default `true`.
  - Module-level cached boolean; `loadSoundsEnabled()` at app start; `isSoundsEnabled()` synchronous for the coordinator; `setSoundsEnabled()` updates storage and cache.
- **`playAlertSound.ts`**:
  - Move the existing `expo-audio` playback logic from `livechat.tsx`.
  - Use the user-picked custom sound when present, otherwise `assets/notification_sound/kmcq-gmbh-doorbell.mp3`.
  - If the custom source fails to load or play, fall back to the bundled default once.
  - Single module-level player; release on finish; never throw.
- **`alertCoordinator.ts`**:
  - `Map<number, number>` of `conversationId → highest alerted messageId`.
  - `seedConversation(conversationId, messageId)`: initial watermark without sound; only raises the stored watermark, never lowers it.
  - `notifyNewMessage({ conversationId, messageId, sender, muted })`:
    1. Ignore invalid IDs.
    2. If `messageId <= watermark`, return (duplicate).
    3. Update watermark.
    4. If `sender === "agent"`, return.
    5. If `muted`, return.
    6. If `!isSoundsEnabled()`, return.
    7. `void playAlertSound()`.
  - Watermark is updated even when muted/sounds-off/agent, so old messages do not ring when the state changes.
  - Map is bounded (e.g., clear entries beyond 500 conversations) to avoid unbounded growth.
- **`pendingConversation.ts`**:
  - `setPendingConversationId(id)`, `consumePendingConversationId()`.
  - Used when a notification is tapped before auth completes.

### 7.3 Foreground alert flow and duplicate prevention

- On the first conversations load, seed every conversation's watermark from `lastMessageId`; do not ring.
- On subsequent conversations polls, for each conversation with a newer `lastMessageId`, call the coordinator. This covers arrivals in non-selected conversations and works even when push permission is denied.
- In the selected message poll:
  - On first load (`lastMessageIdRef.current === 0`), seed the coordinator with the newest message ID.
  - On later loads, if the newest ID increased, call the coordinator.
- The push received listener also calls the coordinator with the push's `messageId`.
- Server push uses `systemId` when the first-message auto-greeting was inserted; otherwise `visitorId`. This ensures the push message ID equals the newest message ID the polls will see, so the first message does not ring twice.
- The coordinator's per-conversation highest-ID watermark makes poll/push order irrelevant.
- The OS notification is suppressed for real messages in the foreground, so only the in-app sound plays.
- If the app is on a screen other than LiveChat, only the push received listener can ring (permission required). This is the documented trade-off of approach A.

### 7.4 Permission and registration flow

- App start: set the handler, create the Android channel, load sounds preference, observe notification taps, and call `registerForPushIfPermitted()` after authentication.
- LiveChat screen after `checkAuth()` succeeds: call `registerForPushIfPermitted()` once.
- Login screen after successful login: call `registerForPushIfPermitted()` after routing.
- `notification-sound.tsx` UI:
  - Current permission status; refresh it whenever the screen gains focus (e.g., after returning from system settings).
  - `Enable notifications` when undetermined: requests permission, gets the Expo token, registers; on denial shows an explanation and `Open settings`.
  - When granted: shows enabled, allows re-register/test.
  - When denied: shows `Open settings` (`Linking.openSettings()` from `expo-linking`).
  - `Send test notification` calls `POST /api/mobile/livechat/push/test`.
  - Sounds toggle (`Switch`) for the local foreground preference.
  - Hint: custom sound applies to foreground; push uses the bundled doorbell.
- No automatic permission prompt at launch.

### 7.5 Deep link and cold start

- Notification data: `{ type: "livechat_message", conversationId: number, messageId: number }`.
- On tap, validate `conversationId` as a positive integer; ignore invalid/missing values.
- `pendingConversation.ts` stores the ID.
- The response listener calls `router.push({ pathname: "/livechat", params: { conversationId: String(id) } })`.
- `index.tsx` after auth and `login.tsx` after login consume the pending ID and route to `/livechat?conversationId=...`.
- `livechat.tsx` reads `useLocalSearchParams`, sets the selected conversation directly (no agent-assignment prompt), consumes any matching pending ID, and clears the route param after handling.
- If the notification is tapped while already on LiveChat, the effect switches conversations.
- If the conversation no longer exists, `loadMessages` handles the error without crashing; the user stays on the list.

### 7.6 Mute UI

- Add `muted?: boolean`, `lastMessageId?: number | null`, and `lastMessageSender?: string | null` to the mobile `Conversation` type. The server already returns the last-message fields; they drive foreground detection.
- Chat header gets a `Mute`/`Unmute` text button. On press:
  - `PATCH /api/mobile/livechat/conversations/:id` with `{ muted: boolean }`.
  - Update local selected state and refresh the conversations list.
- Conversations list shows a small `Muted` label.
- The selected-message poll passes the current mute state to the coordinator.
- The conversations poll passes each conversation's `muted` value.
- Server-side mute suppresses future pushes for that admin.

### 7.7 Web, simulator, and Expo Go behavior

- Web: import no-op `setup.web.ts`/`push.web.ts`; no push registration; foreground sound still uses `expo-audio` if the web build supports it.
- Simulator/emulator without push support: `Device.isDevice` guard shows “Push notifications require a physical device.”
- Expo Go on Android: remote push is unavailable since SDK 53. `getExpoPushTokenAsync` failure is caught and the UI explains that a development build is required.
- Missing `projectId`: clear configuration error, no crash.
- Offline during registration: show a retryable error; foreground polling continues to work.

## 8. Server design

### 8.1 Dependency

- Add `expo-server-sdk` to `dev_app_nextjs`.
- Expo Push Service handles FCM/APNs; no FCM server key or APNs key is added to the Next.js server.
- Optional `EXPO_ACCESS_TOKEN` environment variable is passed to the SDK when set. If Expo push security is enabled in the dashboard, this is required; otherwise the API works without it.

### 8.2 Migration

New file `scripts/migration-add-livechat-mobile-push.sql` (idempotent):

```sql
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

- Update `tests/helpers/db.ts` to apply this migration after phase 6 and truncate both new tables (mutes before conversations).
- Add a migration integration test verifying the tables/columns and idempotency.

### 8.3 Mobile push module

New `lib/livechat/mobile-push.ts`:

- Constants:
  - `MOBILE_PUSH_CHANNEL = "livechat"`
  - `MOBILE_PUSH_SOUND = "kmcq_gmbh_doorbell.wav"`
  - Title `New LiveChat message`.
- Types:
  - `MobilePushInput = { conversationId: number; visitorName: string; messageId: number }`
  - `MobilePushResult = { sent: number; pruned: number; failed: number; tokens: number }`
- Functions:
  - `isValidMobilePushToken(value)` using `Expo.isExpoPushToken` and a 255-character cap.
  - `saveMobilePushToken(adminId, token, platform)`: upsert by unique token; reassign to the latest admin.
  - `removeMobilePushToken(adminId, token)`: delete scoped to the admin.
  - `countMobilePushTokensForAdmin(adminId)`.
  - `buildMobilePushMessage(token, input)`:
    ```json
    {
      "to": "ExponentPushToken[...]",
      "title": "New LiveChat message",
      "body": "Anna Weber",
      "data": {
        "type": "livechat_message",
        "conversationId": 42,
        "messageId": 1001
      },
      "sound": "kmcq_gmbh_doorbell.wav",
      "channelId": "livechat",
      "priority": "high",
      "collapseId": "livechat-conversation-42",
      "tag": "livechat-conversation-42",
      "threadId": "livechat-conversation-42"
    }
    ```
    `sound`, `threadId` target iOS; `channelId`, `tag` target Android; `collapseId` applies to both.
  - `sendMobileVisitorMessagePush(input)`:
    - Select tokens where the admin has no mute row for the conversation:
      ```sql
      SELECT t.id, t.token
      FROM livechat_mobile_push_tokens t
      WHERE NOT EXISTS (
        SELECT 1 FROM livechat_mobile_conversation_mutes m
        WHERE m.conversation_id = ? AND m.admin_id = t.admin_id
      )
      ```
    - Validate tokens, build messages, chunk (max 100), send via `expo-server-sdk`.
    - Inspect push tickets. On `status === "error"` and `details.error === "DeviceNotRegistered"`, delete that token and count `pruned`. Other ticket errors count `failed`.
    - If a whole chunk throws, count its messages as `failed`; retry once on 429/5xx with a short delay.
    - Never throw.
    - Log only `sent`, `pruned`, `failed`, and error codes. Never log tokens, titles/bodies, visitor names, or message contents.
  - `sendTestMobilePush(adminId)`:
    - Select that admin's tokens, ignore mutes.
    - Send title `KMCQ LiveChat`, body `Test notification`, data `{ type: "test" }`, same sound/channel.
    - Return counts; no throw.
- Invalid tokens in the database are pruned or skipped without logging.

### 8.4 API routes

All routes call `requireLivechatMobileAuth()`.

- `POST /api/mobile/livechat/push/register`
  - Body `{ token: string, platform?: "ios" | "android" }`.
  - Validate token; 422 for invalid; 400 for malformed body.
  - Upsert; return `{ ok: true }`.
- `POST /api/mobile/livechat/push/unregister`
  - Body `{ token: string }`.
  - Delete only this admin's token; return `{ ok: true }`.
- `POST /api/mobile/livechat/push/test`
  - No body required.
  - Send to the current admin's tokens only; return `{ sent, failed, tokens }`.
  - 200 with zero counts if no tokens (UI shows “No registered device yet”).

### 8.5 Conversation API changes

`GET /api/mobile/livechat/conversations`:

- Add `muted` per conversation for the current admin, e.g.:
  ```sql
  (SELECT COUNT(*) FROM livechat_mobile_conversation_mutes m
   WHERE m.conversation_id = c.id AND m.admin_id = ?) > 0 AS muted
  ```
- Return `muted: boolean` in each conversation object.
- Preserve the existing `lastMessageId` and `lastMessageSender` fields; they drive the foreground coordinator.

`GET /api/mobile/livechat/conversations/:id`:

- Return `muted` for the current admin (pass the admin ID into `loadConversation` or query separately).
- Preserve the existing conversation fields and messages array.

`PATCH /api/mobile/livechat/conversations/:id`:

- Accept optional `muted: boolean`.
- `true`: `INSERT IGNORE INTO livechat_mobile_conversation_mutes (conversation_id, admin_id) VALUES (?, ?)`.
- `false`: `DELETE FROM livechat_mobile_conversation_mutes WHERE conversation_id = ? AND admin_id = ?`.
- A mute-only PATCH must succeed even if no other update fields are provided.
- Return the updated conversation including `muted`.
- Do not change the existing status/assignedAgentId behavior.

### 8.6 Push trigger

In `app/api/livechat/messages/route.ts`, after the transaction commits and alongside the existing Web Push call:

```ts
void sendMobileVisitorMessagePush({
  conversationId: conv.id,
  visitorName: conv.visitor_name,
  messageId: systemId > 0 ? systemId : visitorId,
}).catch(() => {});
```

- Fire-and-forget; the visitor request must not wait.
- Only visitor message creation triggers mobile push.
- Agent replies (`/api/mobile/livechat/conversations/:id/reply` and admin reply routes) do not trigger it.
- `systemId` is used when the first-message auto-greeting exists so the notification's `messageId` matches the newest message the mobile polls will see.

## 9. Security and privacy

- Push token endpoints require the mobile JWT.
- The visitor message event is already authenticated by the conversation resume token; mobile push is triggered only from that route.
- `EXPO_ACCESS_TOKEN` stays in the server environment.
- FCM V1/APNs credentials live in EAS, not in the app or the Next.js repo.
- The app only stores the Expo push token in SecureStore for unregister; it is never displayed or logged.
- Notification content contains the visitor name only; no message body, email, or token.
- Server logs contain counts and Expo error codes only.
- No automatic permission prompt; the OS/user remains in control.
- Mute is per-admin and affects future pushes only.

## 10. Testing strategy

### Server (Vitest)

Unit tests (`tests/unit/livechat-mobile-push.test.ts`), mocking `expo-server-sdk` and `@/lib/db`:

- Token validation accepts Expo tokens and rejects malformed/oversized values.
- Payload shape includes title, visitor-name body, data IDs, sound, channel, priority, and collapse fields.
- Mute-filtered token query is used for visitor messages.
- `DeviceNotRegistered` ticket errors prune the token.
- Transient ticket/request errors keep the token and count failures.
- No tokens → no SDK call and zero counts.
- Database/SDK failures never throw.
- Console logging never includes a token or message content.

Integration tests (`tests/integration/mobile-livechat-push.test.ts`) with the real test DB and mocked mobile auth:

- Register/unregister are authenticated and scoped per admin.
- Registering the same token twice keeps one row.
- Registering a token for a new admin reassigns it.
- Test endpoint sends only to the current admin's tokens (SDK mocked).
- Mute PATCH creates/removes the per-admin row.
- Conversations list/detail return `muted` for the current admin and not for another admin.
- Migration test for the new tables.

Update `tests/helpers/db.ts` to load the new migration and truncate the new tables.

### Mobile (Jest + jest-expo)

Add `jest-expo` and Jest dev dependencies; configure the Expo preset.

Coordinator tests:

- First visitor message plays once.
- Same `conversationId`/`messageId` from poll and push plays once.
- Higher message ID plays again.
- Agent message does not play and still advances the watermark.
- Muted conversation does not play and still advances the watermark.
- Sounds disabled does not play and still advances the watermark.
- Seeding suppresses sound for history.
- Different conversations are independent.

Push helper tests (mocking `expo-notifications`, `expo-constants`, `expo-device`, `expo-secure-store`, and `api`):

- Permission denied does not request a token or register.
- Granted permission registers the token with the server.
- Missing project ID returns a configuration error.
- Offline/token failure is caught.
- Unregister calls the server and clears local storage.
- Notification data parsing accepts a valid conversation ID and rejects invalid data.

Deep-link tests:

- Pending conversation is consumed once.
- Valid notification data routes to `/livechat` with the ID.
- Invalid/missing ID is ignored.
- `parseLivechatMessageData` accepts valid IDs and rejects wrong type, missing, negative, or non-integer IDs.

### Verification commands

- Server: `npm test`, `npx tsc --noEmit`.
- Mobile: `npm test` (new), `npx tsc --noEmit`.
- Mobile dependency checks: `npx expo install --check`, `npx expo-doctor`.
- No EAS build, prebuild, `expo run:*`, or local native build.

## 11. Manual test matrix

Run after an EAS development/preview build on a physical device; not part of this implementation session.

| Scenario | Expected |
|---|---|
| Foreground, LiveChat screen, new visitor message | One in-app sound; no OS banner/sound; no duplicate from push. |
| Foreground, other screen, notifications granted | In-app sound from push listener; no OS banner. |
| Foreground, notifications denied | In-app sound on LiveChat screen; no sound on other screens. |
| Background | OS notification with sound; correct visitor name; no message text. |
| Terminated | OS notification with sound; tapping opens the conversation (login first if needed). |
| Muted conversation | No foreground sound, no push; other conversations still alert. |
| Agent reply / own message | No sound and no push. |
| Duplicate push/poll arrival | One sound only. |
| Permission denied | Clear UI state; foreground polling still works; Open settings works. |
| No registered token | Test button reports zero devices; foreground works. |
| Offline device | No crash; notification delivered when possible; tap opens conversation. |
| Android 8+ | Custom sound plays from the `livechat` channel; channel settings respected. |
| iOS | Bundled `kmcq_gmbh_doorbell.wav` plays; Focus/silent settings respected. |
| Reinstall/clear data | Token re-registers after login and permission check. |
| Logout | Token unregistered; no pushes to the logged-out device. |
| Two admins, one mutes | Only the muting admin's devices stop receiving that conversation's pushes. |

## 12. Setup and deployment

1. Mobile: install `expo-notifications`, add the plugin/sound, and rebuild the native app (EAS) — **not in this session**.
2. EAS: configure FCM V1 credentials for Android and an APNs key for iOS in the Expo project.
3. Server: `npm install expo-server-sdk`; run `scripts/migration-add-livechat-mobile-push.sql`.
4. Server env: optionally set `EXPO_ACCESS_TOKEN`; if Expo push security is enabled, it is required.
5. Server: restart `next start` so the new routes/module load.
6. Mobile: install a development/preview build (Expo Go Android cannot receive remote push since SDK 53).
7. Verify permission flow, test notification, foreground/background/terminated behavior.

## 13. Documentation

Add `docs/notifications.md` to the mobile repo covering:

- Architecture and data flow.
- EAS FCM V1/APNs setup and the optional `EXPO_ACCESS_TOKEN`.
- Migration and server env.
- Development build requirement and Expo Go limitation.
- Permission behavior and denied-state recovery.
- Foreground vs background sound ownership.
- Android channel immutability and the underscore sound filename.
- Bundled push sound vs user-picked foreground sound.
- Notification content policy (visitor name only).
- Mute semantics (per-admin, future pushes only).
- Manual test matrix.
- Known limitations: best-effort delivery, no receipt polling, force-stopped Android, OS Focus/silent settings, foreground-other-screen reliance on push.

## 14. Files to change

### Mobile

- `package.json` / `package-lock.json` — add `expo-notifications`, Jest dev dependencies.
- `app.json` — add the `expo-notifications` plugin and sound.
- `assets/notification_sound/kmcq_gmbh_doorbell.wav` — new underscore filename.
- `src/app/_layout.tsx` — initialize notifications and observers.
- `src/app/index.tsx` — consume pending conversation after auth.
- `src/app/login.tsx` — register if permitted; consume pending conversation.
- `src/app/livechat.tsx` — coordinator integration, mute UI/state, deep-link param, registration.
- `src/app/notification-sound.tsx` — sounds toggle, push permission/registration/test UI.
- `src/lib/notifications/setup.ts`, `setup.web.ts`
- `src/lib/notifications/notificationData.ts`
- `src/lib/notifications/push.ts`, `push.web.ts`
- `src/lib/notifications/preferences.ts`
- `src/lib/notifications/playAlertSound.ts`
- `src/lib/notifications/alertCoordinator.ts`
- `src/lib/notifications/pendingConversation.ts`
- `src/lib/notifications/__tests__/*`
- `docs/notifications.md`
- `jest.config.js` / `package.json` test script (or the equivalent Expo/Jest setup)
- `docs/superpowers/specs/2026-11-07-livechat-push-notifications-design.md` (this file)

### Server

- `package.json` / lockfile — add `expo-server-sdk`.
- `lib/livechat/mobile-push.ts`
- `app/api/mobile/livechat/push/register/route.ts`
- `app/api/mobile/livechat/push/unregister/route.ts`
- `app/api/mobile/livechat/push/test/route.ts`
- `app/api/mobile/livechat/conversations/route.ts` — `muted` in list.
- `app/api/mobile/livechat/conversations/[id]/route.ts` — `muted` in detail/PATCH.
- `app/api/livechat/messages/route.ts` — fire-and-forget mobile push.
- `scripts/migration-add-livechat-mobile-push.sql`
- `tests/helpers/db.ts`
- `tests/unit/livechat-mobile-push.test.ts`
- `tests/integration/mobile-livechat-push.test.ts`
- `tests/integration/livechat-mobile-push-migration.test.ts`

## 15. Approval

Approved by the user on 2026-11-07: approach A, Expo Push Service with server changes, per-admin mute, visitor-name-only content, local per-device sounds toggle.
