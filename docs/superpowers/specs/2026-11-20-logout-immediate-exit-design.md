# Logout immediately exits app

## Goal

Change the LiveChat logout flow so a successful logout closes the app immediately on Android. The app must not navigate to the Login screen after logout, and there must be no delayed close timer or route flag.

## Decisions

- Platform: Android exits via `BackHandler.exitApp()` as soon as `POST /api/mobile/livechat/auth/logout` resolves.
- iOS and web stay on the LiveChat screen after a successful logout. Programmatic app exit is not supported on these platforms.
- Logout success means the logout API resolves. Local cleanup still happens before the API call, as it does today.
- Logout failure shows an error alert and keeps the user on LiveChat. It never exits and never navigates to Login.
- No Login screen wiring, timer, delay, URL param, or in-process marker remains.

## Components and data flow

### `src/app/livechat.tsx`

- Keep the existing local cleanup at the start of `handleLogout`: disable push auth, unregister push notifications while ignoring failures, and clear the pending conversation id.
- Await `api.post("/api/mobile/livechat/auth/logout")`.
- On success, call `BackHandler.exitApp()` only when `Platform.OS === "android"`.
- On failure, show an alert using the existing error message fallback and return without navigation or exit.
- Import `BackHandler` from `react-native`; `Platform` and `Alert` are already imported.
- Remove the imports and calls for `LOGOUT_CLOSE_PARAM`, `LOGOUT_CLOSE_VALUE`, and `markLogoutClosePending`.

### `src/app/login.tsx`

- Remove `useCallback`, `useEffect`, `useRef`, `BackHandler`, `router`, and `useLocalSearchParams` imports that were added only for auto-close.
- Remove the `closeAfterLogout` param read, timer ref, armed ref, cancel callback, mount effect, and root `onTouchStart` handler.
- Keep the existing email/code/credentials login form unchanged.

### Helper and tests

- Delete `src/lib/logoutAutoClose.ts`.
- Delete `src/lib/__tests__/logoutAutoClose.test.ts`.
- Do not add a replacement helper. The platform check and `BackHandler.exitApp()` call are direct and local to `handleLogout`.

### Documentation

- Delete the superseded spec `docs/superpowers/specs/2026-11-19-auto-close-after-logout-design.md`.
- This spec is the source of truth for the logout behavior.

## Error handling

- Push unregister failures are swallowed as today and do not block logout.
- Logout API rejection shows `Alert.alert("Error", error.response?.data?.error || "Failed to log out")` and leaves the current screen unchanged.
- Android `BackHandler.exitApp()` is best effort; no UI error is surfaced.
- iOS/web perform no exit and show no new UI after successful logout.

## Verification

- `npm test -- --runInBand` passes after obsolete helper tests are deleted.
- `npx tsc --noEmit` has no new errors in touched files.
- `npx expo lint` has no new issues in touched lines.
- Manual smoke tests:
  1. Android, successful logout -> app exits immediately; Login screen never appears.
  2. Android, failing logout -> error alert appears and app stays on LiveChat.
  3. iOS/web, successful logout -> app stays on LiveChat; no Login screen.
  4. Fresh app start -> Login screen works normally.

## Out of scope

- iOS programmatic exit.
- Adding a logged-out screen or any navigation after logout.
- Keeping the delayed-close or deep-link marker design.
- Changing session/auth storage behavior.
