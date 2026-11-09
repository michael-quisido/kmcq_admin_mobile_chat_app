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
