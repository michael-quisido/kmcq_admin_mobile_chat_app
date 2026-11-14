# LiveChat notifications

## How alerts work

Foreground alerts are detected by the 5-second conversation poll, the 2-second open-conversation poll, and Expo's foreground notification listener. The app compares the newest message ID per conversation with an in-memory watermark and plays the shared doorbell once. After a background or terminated push tap, the first load seeds the current message IDs instead of ringing, so reopening a conversation does not replay old messages. For real messages in the foreground the Expo banner is suppressed; only the in-app sound plays. Android also updates a silent list-only notification for the conversation.

Background and terminated alerts use direct FCM on Android and Expo Push on iOS. The server sends one message per active token across non-muted admins. Android tokens registered by current builds are native FCM tokens; iOS tokens are Expo tokens. Mobile push is sent regardless of whether the visitor or admin is in the foreground; foreground behavior is handled by the native Android service and client-side JS. It skips admins who muted the conversation.

Android FCM payloads are data-only high-priority messages so the native service can display the `MessagingStyle`/bubble notification even when the app process is cached, frozen, or killed:

- data: `{ "body": "{\"type\":\"livechat_message\",\"conversationId\":12,\"messageId\":345,\"senderName\":\"Visitor\"}" }`
- android.priority: `high`

The data-only payload deliberately has no `notification` block, so Expo's foreground handler does not show a duplicate system notification. The native service owns the visible notification, its `livechat_v2` channel, and the bundled doorbell sound. Android still requires the app-level bubble permission for a floating bubble; without it the notification is heads-up but not a bubble.

For legacy Android Expo tokens, the server still sends the previous system notification payload with `systemNotification: "1"`; the native service skips its own notification to avoid duplicates. Registering an Android FCM token removes the same admin's legacy Android Expo tokens.

iOS and unknown-platform Expo push payloads keep the alert payload:

- title: `New LiveChat message`
- body: the visitor display name
- data: `{ "type": "livechat_message", "conversationId": 12, "messageId": 345, "senderName": "Visitor" }`

Expo mobile push payloads never include the message body. The separate Web Push path can still include a short visitor message preview, and Web Push does not currently honor conversation mutes.

## Android bubbles

The local `livechat-bubbles` Expo module subclasses `ExpoFirebaseMessagingService`. It parses the `body` JSON from direct FCM data messages and posts a silent list-only notification in the foreground or a `MessagingStyle`/shortcut/`BubbleMetadata` notification in the background. Legacy Expo notification messages with `systemNotification: "1"` are skipped so they do not duplicate the system notification.

The native service is registered by the module manifest. The `withLivechatBubbles` config plugin removes Expo's lower-priority FCM service declaration and marks `MainActivity` resizeable so bubbles can open as an activity. The app still calls Expo's listener for foreground JS events; Expo suppresses its own foreground banner.

The native module owns the Android `livechat_v2` channel. Expo's `setNotificationChannelAsync` is not used for this channel because it resets the native importance, sound, vibration, and bubble fields on app startup. The native module creates the channel with `IMPORTANCE_HIGH`, the bundled doorbell sound, vibration, badges, and bubbles enabled. Heads-up presentation is controlled by channel importance and notification priority; the system notification supplies `channelId: livechat_v2` and `priority: high`. The new channel ID is a deliberate one-time reset: Android does not allow apps to change immutable channel fields such as the bubble flag after creation, so older installs would otherwise keep a channel created by Expo. The legacy `livechat` channel is deleted after the new channel is created; after that the channel is left alone so users can change its settings in Android.

## Muting

Mute is per admin and per conversation. It is stored in
`livechat_mobile_conversation_mutes`. For Expo mobile push, muting suppresses foreground sound and server push delivery for that admin. Unread counts keep updating. Web Push does not currently honor conversation mutes.

## Foreground sound

The foreground sound uses the custom file selected on the Notification Sound screen, then
falls back to the bundled `kmcq_gmbh_doorbell.mp3`. The separate "In-app sounds" switch
controls foreground playback only.

Android notification channel sound is fixed when the channel is created. If a user changes the channel sound in Android system settings, recreating the channel requires uninstalling/reinstalling the app or clearing app data.

iOS background push sounds must be bundled files (`wav`, `caf`, or `aiff`). A user-picked
sound applies to foreground playback only; changing a remote push sound would require a
new app release.

## Server setup

Apply `scripts/migration-add-livechat-mobile-push.sql` before deploying the API changes.
The server uses `expo-server-sdk@^6.1.0` for iOS and `firebase-admin@^13.6.0` for direct
Android FCM. `firebase-admin` 13.x supports the production Node 20 runtime; do not upgrade
to 14.x without also upgrading the runtime to Node 22 or newer.

Android direct FCM needs Firebase Admin credentials. Provide either:

1. `FIREBASE_SERVICE_ACCOUNT_JSON` with the service account JSON as a single-line string, or
2. `GOOGLE_APPLICATION_CREDENTIALS` pointing to the service account file, or another
   application-default credential source.

Never commit the service account JSON. The mobile repo already ignores
`*firebase-adminsdk*.json` and `firebase-service-account*.json`.

iOS production push delivery still needs EAS project credentials:

1. Upload the APNs key or certificate for iOS.
2. Confirm the `extra.eas.projectId` in `app.json` matches the Expo project.

## Mobile setup

`expo-notifications` is configured through the app config plugin. The WAV used for remote
push is `assets/notification_sound/kmcq_gmbh_doorbell.wav`; the hyphenated MP3 remains the
foreground fallback. Android resource names cannot contain hyphens.

After authentication, startup and login register a token only if notification permission is already granted. Android registers the native FCM token with `Notifications.getDevicePushTokenAsync()`; iOS registers an Expo token with `getExpoPushTokenAsync()`. A fresh install must open Notification Sound and tap "Enable push notifications" to request permission and register. Logout unregisters the device token.

## Verification

```bash
# mobile
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
npm test -- --runInBand
npx tsc --noEmit
npx expo install --check
npx expo-doctor

# server (run from the server repo)
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null
npm test
npx tsc --noEmit
```

Remote push checks require a development or production build. Expo Go on Android cannot receive remote push.

Manual device checks:

1. Foreground with two conversations: one sound per new visitor message, no sound for agent replies.
2. Background: notification arrives from direct FCM on Android or Expo Push on iOS, and tapping opens the correct conversation.
3. Terminated: notification arrives from direct FCM on Android or Expo Push on iOS, and tapping opens the correct conversation after authentication.
4. Muted conversation: no sound in any state, unread count still increases.
5. Custom sound: foreground uses the picked file; background uses the bundled WAV.
6. Server test push: on Android it arrives as an FCM notification message; live visitor messages arrive as data-only FCM messages and are rendered by the native service.

Do not run EAS builds, prebuild, or native builds as part of this verification.
