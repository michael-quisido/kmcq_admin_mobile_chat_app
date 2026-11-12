# LiveChat notifications

## How alerts work

Foreground alerts are detected by the 5-second conversation poll, the 2-second open-conversation poll, and Expo's foreground notification listener. The app compares the newest message ID per conversation with an in-memory watermark and plays the shared doorbell once. After a background or terminated push tap, the first load seeds the current message IDs instead of ringing, so reopening a conversation does not replay old messages. For real messages in the foreground the Expo banner is suppressed; only the in-app sound plays. Android also updates a silent list-only notification for the conversation.

Background and terminated alerts use Expo Push. The server builds one Expo message per active token across non-muted admins. Mobile push is sent regardless of whether the visitor or admin is in the foreground; foreground behavior is handled by the native Android service and client-side JS. It skips admins who muted the conversation.

Android push payloads are data-only and contain:

- data: `{ "type": "livechat_message", "conversationId": 12, "messageId": 345, "senderName": "Visitor" }`

iOS and unknown-platform push payloads keep the alert payload:

- title: `New LiveChat message`
- body: the visitor display name
- data: `{ "type": "livechat_message", "conversationId": 12, "messageId": 345, "senderName": "Visitor" }`

Expo mobile push payloads never include the message body. The separate Web Push path can still include a short visitor message preview, and Web Push does not currently honor conversation mutes.

## Android bubbles

The local `livechat-bubbles` Expo module subclasses `ExpoFirebaseMessagingService`. It receives data-only LiveChat pushes, posts a `MessagingStyle` conversation notification with a long-lived shortcut and `BubbleMetadata`, and deep-links to `kmcqadminmobilechatapp://livechat?conversationId=...`. Android may always show the notification in the shade while declining the floating-bubble presentation; closing, muting, or logging out clears the conversation shortcut and notification.

The native service is registered by the module manifest. The `withLivechatBubbles` config plugin removes Expo's lower-priority FCM service declaration and marks `MainActivity` resizeable so bubbles can open as an activity. The app still calls Expo's listener for foreground JS events; Expo suppresses its own foreground banner.

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

After authentication, startup and login register a token only if notification permission is already granted. A fresh install must open Notification Sound and tap "Enable push notifications" to request permission and register. Logout unregisters the device token.

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
2. Background: notification arrives from Expo Push and tapping opens the correct conversation.
3. Terminated: notification arrives and tapping opens the correct conversation after authentication.
4. Muted conversation: no sound in any state, unread count still increases.
5. Custom sound: foreground uses the picked file; background uses the bundled WAV.

Do not run EAS builds, prebuild, or native builds as part of this verification.
