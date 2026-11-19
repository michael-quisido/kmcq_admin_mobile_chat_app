# Auto-close app after successful logout

## Goal

After a user logs out from the LiveChat screen, show the Login screen, let it render, then close the app automatically after ~1.8 seconds. This must happen only for a successful logout session; a fresh app start or any other navigation to Login must never close the app.

## Decisions

- Platform: Android only. Android closes via `BackHandler.exitApp()`. iOS and web stay on the Login screen (iOS does not permit programmatic app exit).
- Logout success: only when `POST /api/mobile/livechat/auth/logout` resolves. On failure, navigate to plain `/login` with no close.
- "Login loaded": the Login screen's `useEffect` on mount. No extra network check.
- Delay: 1800 ms (within the requested 1.5–2 s range).

## Components and data flow

### `src/app/livechat.tsx`

- `handleLogout` keeps local cleanup (`setPushAuthEnabled(false)`, unregister push, clear pending conversation).
- On API success: `router.replace({ pathname: "/login", params: { closeAfterLogout: "1" } })`.
- On API failure: `router.replace("/login")` (unchanged fallback behavior).

### `src/app/login.tsx`

- Read `useLocalSearchParams<{ closeAfterLogout?: string }>()`.
- On mount, if the flag is present:
  1. Clear the flag with `router.setParams({ closeAfterLogout: undefined })` so a remount/reload cannot re-arm the timer.
  2. Start an 1800 ms timer.
  3. On fire, if `Platform.OS === "android"`, call `BackHandler.exitApp()`; otherwise do nothing.
- Clear the timer on unmount.
- Cancel the timer on any user interaction with the login form (text input or button press) so the app never closes while the user is logging back in.

### Helper (testable)

- Add a small pure helper, for example `isLogoutCloseParam(value: string | string[] | undefined): boolean`, in a lib module outside `src/app/`. The Login screen uses it to decide whether to arm the timer. This keeps the "only a logout session" rule unit-testable without rendering the screen.

## Error handling

- Logout API rejection: no flag, no timer.
- Missing/malformed flag: no timer.
- Android `BackHandler.exitApp()` is best effort; no UI error is surfaced.
- iOS/web: flag is accepted but no exit occurs; no visible difference to the user.

## Verification

- `npx tsc --noEmit` and `npx expo lint`.
- Unit tests for the helper: `"1"` → true; `undefined`, `"0"`, arrays → false.
- Manual smoke tests:
  1. Fresh app start → Login → app stays open.
  2. Logout with successful API → Login → app closes after ~1.8 s on Android.
  3. Logout with failing API → Login → app stays open.
  4. Logout, then type in Login before 1.8 s → app stays open.

## Out of scope

- iOS programmatic exit (uses private APIs and risks App Store rejection).
- Changing session/auth storage behavior.
- Web behavior changes.
