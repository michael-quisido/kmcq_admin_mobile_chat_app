# Auto-close app after successful logout

## Goal

After a user logs out from the LiveChat screen, show the Login screen, let it render, then close the app automatically after ~1.8 seconds. This must happen only for a successful logout session; a fresh app start or any other navigation to Login must never close the app.

## Decisions

- Platform: Android only. Android closes via `BackHandler.exitApp()`. iOS and web stay on the Login screen (iOS does not permit programmatic app exit).
- Logout success: only when `POST /api/mobile/livechat/auth/logout` resolves. On failure, navigate to plain `/login` with no close.
- The URL flag must be paired with an in-process marker set only on successful logout, so deep links alone cannot arm the timer.
- "Login loaded": the Login screen's `useEffect` on mount. No extra network check.
- Delay: 1800 ms (within the requested 1.5–2 s range).

## Components and data flow

### `src/app/livechat.tsx`

- `handleLogout` keeps local cleanup (`setPushAuthEnabled(false)`, unregister push, clear pending conversation).
- On API success: call `markLogoutClosePending()`, then `router.replace({ pathname: "/login", params: { [LOGOUT_CLOSE_PARAM]: LOGOUT_CLOSE_VALUE } })`.
- On API failure: `router.replace("/login")` (unchanged fallback behavior).

### `src/app/login.tsx`

- Read `useLocalSearchParams<{ closeAfterLogout?: string }>()`.
- On mount, if the flag is present and `consumeLogoutClosePending()` returns true:
  1. Clear the flag with `router.setParams({ [LOGOUT_CLOSE_PARAM]: undefined })` so a remount/reload cannot re-arm the timer.
  2. Create a `createLogoutAutoCloseController({ isAndroid: Platform.OS === "android", onExit: () => BackHandler.exitApp() })` and call `arm()`.
  3. The controller waits 1800 ms, then calls `BackHandler.exitApp()` only on Android; otherwise it does nothing.
- Cancel the controller on unmount.
- Cancel the timer on any user interaction with the login form (text input or button press) so the app never closes while the user is logging back in.

### Helper (testable)

- A lib module outside `src/app/` provides `LOGOUT_CLOSE_PARAM`, `LOGOUT_CLOSE_VALUE`, `LOGOUT_CLOSE_DELAY_MS`, `isLogoutCloseParam`, `markLogoutClosePending`, `consumeLogoutClosePending`, and `createLogoutAutoCloseController`.
- `markLogoutClosePending()` sets the in-process marker only after a successful logout API call; `consumeLogoutClosePending()` reads and clears it once on Login mount. The Login screen requires both the valid URL flag and the marker before arming.
- `createLogoutAutoCloseController` owns the 1800 ms timer with `arm()`/`cancel()` (re-arming cancels the prior timer), which keeps the timer lifecycle unit-testable without rendering the screen.

## Error handling

- Logout API rejection: no flag, no timer.
- Missing/malformed flag: no timer.
- Flag present without the in-process logout marker (for example a deep link): no timer.
- Android `BackHandler.exitApp()` is best effort; no UI error is surfaced.
- iOS/web: flag is accepted but no exit occurs; no visible difference to the user.

## Verification

- `npx tsc --noEmit` and `npx expo lint`.
- Unit tests for the helper: `"1"` → true; `undefined`, `"0"`, arrays → false; the session marker is consumed only once.
- Unit tests for `createLogoutAutoCloseController` with Jest fake timers: exits on Android after 1800 ms, does not exit on other platforms, `cancel()` prevents exit, and re-arming does not create duplicate timers.
- Manual smoke tests:
  1. Fresh app start → Login → app stays open.
  2. Logout with successful API → Login → app closes after ~1.8 s on Android.
  3. Logout with failing API → Login → app stays open.
  4. Logout, then type in Login before 1.8 s → app stays open.
  5. Fresh process deep link to `/login?closeAfterLogout=1` → app stays open.

## Out of scope

- iOS programmatic exit (uses private APIs and risks App Store rejection).
- Changing session/auth storage behavior.
- Web behavior changes.
