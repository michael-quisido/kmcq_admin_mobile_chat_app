# Auto-close After Successful Logout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a successful LiveChat logout, route to Login with a one-shot flag and close the Android app ~1.8 s after Login renders, unless the user interacts first.

**Architecture:** `src/app/livechat.tsx` adds a route-param flag only after the logout API resolves. `src/app/login.tsx` reads that flag once via `useLocalSearchParams`, clears it via `router.setParams`, starts a cancellable 1800 ms timer, and calls `BackHandler.exitApp()` only on Android. A pure helper outside `src/app/` keeps the flag rule unit-testable.

**Tech Stack:** Expo Router `~58.0.30`, React Native `0.88.1`, Jest via `jest-expo`, TypeScript.

---

### Task 1: Add the pure logout flag helper with tests

**Files:**
- Create: `src/lib/logoutAutoClose.ts`
- Test: `src/lib/__tests__/logoutAutoClose.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/logoutAutoClose.test.ts` with exactly:

```ts
import { describe, expect, it } from "@jest/globals";

import { isLogoutCloseParam } from "../logoutAutoClose";

describe("isLogoutCloseParam", () => {
  it("accepts the logout marker", () => {
    expect(isLogoutCloseParam("1")).toBe(true);
  });

  it("rejects missing and malformed markers", () => {
    expect(isLogoutCloseParam(undefined)).toBe(false);
    expect(isLogoutCloseParam(null)).toBe(false);
    expect(isLogoutCloseParam("0")).toBe(false);
    expect(isLogoutCloseParam("true")).toBe(false);
    expect(isLogoutCloseParam(["1"])).toBe(false);
    expect(isLogoutCloseParam([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --runInBand src/lib/__tests__/logoutAutoClose.test.ts
```

Expected: FAIL with `Cannot find module '../logoutAutoClose'` or `Cannot find module '../logoutAutoClose' from 'src/lib/__tests__/logoutAutoClose.test.ts'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/logoutAutoClose.ts` with exactly:

```ts
export const LOGOUT_CLOSE_PARAM = "closeAfterLogout";

export function isLogoutCloseParam(
  value: string | string[] | null | undefined,
): boolean {
  return value === "1";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- --runInBand src/lib/__tests__/logoutAutoClose.test.ts
```

Expected: PASS, `1 passed suite`, `2 passed tests`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logoutAutoClose.ts src/lib/__tests__/logoutAutoClose.test.ts
git commit -m "test: cover logout auto-close flag"
```

---

### Task 2: Add the logout flag to successful logout navigation

**Files:**
- Modify: `src/app/livechat.tsx:18` (imports)
- Modify: `src/app/livechat.tsx:337-349` (`handleLogout`)

- [ ] **Step 1: Add the helper import**

In `src/app/livechat.tsx`, replace:

```ts
import api from "../lib/api";
```

with:

```ts
import api from "../lib/api";
import { LOGOUT_CLOSE_PARAM } from "../lib/logoutAutoClose";
```

- [ ] **Step 2: Route to Login with the flag only after logout succeeds**

In `src/app/livechat.tsx`, replace the whole `handleLogout` function with:

```ts
  const handleLogout = async () => {
    setPushAuthEnabled(false);
    try {
      await unregisterForPushNotifications();
    } catch {}
    clearPendingConversationId();
    try {
      await api.post("/api/mobile/livechat/auth/logout");
      router.replace({
        pathname: "/login",
        params: { [LOGOUT_CLOSE_PARAM]: "1" },
      });
    } catch (error) {
      router.replace("/login");
    }
  };
```

No other logout cleanup changes. Failed logout must still route to plain `/login`.

- [ ] **Step 3: Typecheck the route change**

Run:

```bash
npx tsc --noEmit
```

Expected: the only remaining error is the pre-existing `src/components/app-tabs.web.tsx(38,6): error TS2322`. There must be no error in `src/app/livechat.tsx` or `src/lib/logoutAutoClose.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/app/livechat.tsx
git commit -m "feat: flag successful logout for auto-close"
```

---

### Task 3: Arm and cancel the auto-close timer on Login

**Files:**
- Modify: `src/app/login.tsx:1-15` (imports)
- Modify: `src/app/login.tsx:17-23` (screen state)
- Modify: `src/app/login.tsx:61-66` (root view)

- [ ] **Step 1: Add React hooks, `BackHandler`, router, and helper imports**

In `src/app/login.tsx`, replace lines 1-15 with:

```ts
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  BackHandler,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import api from "../lib/api";
import { isLogoutCloseParam, LOGOUT_CLOSE_PARAM } from "../lib/logoutAutoClose";
import { routeAfterAuthentication } from "../lib/notifications/authRouting";
```

- [ ] **Step 2: Add one-shot timer state and cancel callback**

In `src/app/login.tsx`, replace:

```ts
export default function LoginScreen() {
  const [step, setStep] = useState<"email" | "code" | "credentials">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
```

with:

```ts
export default function LoginScreen() {
  const [step, setStep] = useState<"email" | "code" | "credentials">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const params = useLocalSearchParams<{ closeAfterLogout?: string }>();
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseArmedRef = useRef(isLogoutCloseParam(params.closeAfterLogout));

  const cancelAutoClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!autoCloseArmedRef.current) return;

    router.setParams({ [LOGOUT_CLOSE_PARAM]: undefined });
    autoCloseTimerRef.current = setTimeout(() => {
      autoCloseTimerRef.current = null;
      if (Platform.OS === "android") {
        BackHandler.exitApp();
      }
    }, 1800);

    return cancelAutoClose;
  }, [cancelAutoClose]);
```

The `autoCloseArmedRef` guard is required: `router.setParams` changes `params`, and keeping `params` in the dependency array would make the cleanup cancel the timer immediately.

- [ ] **Step 3: Cancel the timer on user touch**

In `src/app/login.tsx`, replace:

```tsx
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
```

with:

```tsx
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      onTouchStart={cancelAutoClose}
    >
```

This covers taps on all inputs and buttons inside the Login screen.

- [ ] **Step 4: Typecheck the Login changes**

Run:

```bash
npx tsc --noEmit
```

Expected: the only remaining error is the pre-existing `src/components/app-tabs.web.tsx(38,6): error TS2322`. There must be no error in `src/app/login.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/app/login.tsx
git commit -m "feat: close login after successful logout on android"
```

---

### Task 4: Restore the notification unit-test baseline

The existing notification suites currently fail because the earlier push-auth gating was added without updating their mocks. Fix those tests so the full suite can verify this feature.

**Files:**
- Modify: `src/lib/notifications/__tests__/authRouting.test.ts`
- Modify: `src/lib/notifications/__tests__/push.test.ts`

- [ ] **Step 1: Update the `authRouting` mock**

In `src/lib/notifications/__tests__/authRouting.test.ts`, replace:

```ts
jest.mock("../push", () => ({ registerForPushIfPermitted: jest.fn() }));
```

with:

```ts
jest.mock("../push", () => ({
  registerForPushIfPermitted: jest.fn(),
  setPushAuthEnabled: jest.fn(),
}));
```

- [ ] **Step 2: Assert auth gating in `authRouting`**

In the same file, replace:

```ts
import { registerForPushIfPermitted } from "../push";
```

with:

```ts
import { registerForPushIfPermitted, setPushAuthEnabled } from "../push";
```

Replace:

```ts
const register = jest.mocked(registerForPushIfPermitted);
```

with:

```ts
const register = jest.mocked(registerForPushIfPermitted);
const setPushAuthEnabledMock = jest.mocked(setPushAuthEnabled);
```

In the first test (`"routes to the livechat list when nothing is pending"`), add this assertion after `expect(register).toHaveBeenCalledTimes(1);`:

```ts
    expect(setPushAuthEnabledMock).toHaveBeenCalledWith(true);
```

- [ ] **Step 3: Enable auth in the push test setup**

In `src/lib/notifications/__tests__/push.test.ts`, add `setPushAuthEnabled` to the existing import block from `"../push"` so that the import list starts:

```ts
import {
  configureNotifications,
  getNotificationPermission,
  handleLivechatDeepLink,
  handleNotificationReceived,
  handleNotificationResponse,
  registerForPushIfPermitted,
  registerForPushNotifications,
  requestNotificationPermission,
  sendTestMobilePush,
  setPushAuthEnabled,
  unregisterForPushNotifications,
} from "../push";
```

In `beforeEach`, add this line immediately after `jest.clearAllMocks();`:

```ts
  setPushAuthEnabled(true);
```

- [ ] **Step 4: Add a test proving gating still works**

In `src/lib/notifications/__tests__/push.test.ts`, insert this test at the start of the `describe("registerForPushNotifications", ...)` block, before `"returns null on a simulator without prompting or requesting a token"`:

```ts
  it("does not register tokens before authentication is enabled", async () => {
    setPushAuthEnabled(false);

    await expect(registerForPushNotifications()).resolves.toBeNull();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5: Run the full unit suite**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS, `12 passed suites`, `95 passed tests`. No failing suites.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/__tests__/authRouting.test.ts src/lib/notifications/__tests__/push.test.ts
git commit -m "test: restore notification suite after auth gating"
```

---

### Task 5: Verify and smoke-test the complete flow

**Files:** none.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS, `12 passed suites`, `95 passed tests`.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: exit nonzero only because of the pre-existing `src/components/app-tabs.web.tsx(38,6): error TS2322`. No errors in files touched by this plan.

- [ ] **Step 3: Run lint**

Run:

```bash
npx expo lint
```

Expected: no new warnings or errors from `src/lib/logoutAutoClose.ts`, `src/lib/__tests__/logoutAutoClose.test.ts`, `src/app/livechat.tsx`, `src/app/login.tsx`, or the two notification test files. Pre-existing warnings in other files may remain.

- [ ] **Step 4: Manual Android smoke tests**

Build/install a development build or run on Android, then verify:

1. Fresh app start → Login → app stays open after more than 2 seconds.
2. Successful logout from LiveChat → Login → app closes after ~1.8 s.
3. Failed logout (force `/api/mobile/livechat/auth/logout` to reject) → Login → app stays open.
4. Successful logout → immediately tap an input → app stays open.
5. iOS/Web (if available) → successful logout → Login → app stays open.

- [ ] **Step 5: Check final git state**

Run:

```bash
git status --short
```

Expected: no modified tracked files; the only allowed untracked files are `google-services.json` and `src/app/google-services.json`. Do not stage or push either file. The local spec commit `577a8ba` should remain unpushed unless the user explicitly asks.

---

## Self-review checklist

- [x] Spec requirement: success-only flag → Task 2.
- [x] Spec requirement: failed logout routes to plain `/login` → Task 2.
- [x] Spec requirement: `useLocalSearchParams` on Login → Task 3.
- [x] Spec requirement: clear flag before timer starts → Task 3.
- [x] Spec requirement: 1800 ms timer → Task 3.
- [x] Spec requirement: Android-only `BackHandler.exitApp()` → Task 3.
- [x] Spec requirement: timer cleared on unmount → Task 3 cleanup.
- [x] Spec requirement: cancel on user interaction → Task 3 `onTouchStart`.
- [x] Spec requirement: pure helper and unit tests → Task 1.
- [x] Spec verification commands → Task 5.
- [x] No placeholders, all code shown inline.
- [x] Names consistent: `LOGOUT_CLOSE_PARAM`, `isLogoutCloseParam`, `closeAfterLogout`, `autoCloseTimerRef`, `autoCloseArmedRef`, `cancelAutoClose`.

## Final review fixes

- `src/lib/logoutAutoClose.ts`: added `LOGOUT_CLOSE_VALUE`, `LOGOUT_CLOSE_DELAY_MS`, the one-shot in-process session marker (`markLogoutClosePending` / `consumeLogoutClosePending`), and `createLogoutAutoCloseController` with cancellable, de-duplicated `arm()`/`cancel()` timer lifecycle. The URL value check now uses the shared constant.
- `src/lib/__tests__/logoutAutoClose.test.ts`: added a marker-consumption test and four fake-timer controller tests (Android exit at 1800 ms, non-Android no-op, cancel, no duplicate timers).
- `src/app/livechat.tsx`: `markLogoutClosePending()` runs only after the logout API resolves, and the route flag uses `LOGOUT_CLOSE_VALUE`. Failed logout still routes to plain `/login`.
- `src/app/login.tsx`: consumes the in-process marker before arming, clears the route flag, and delegates the timer to `createLogoutAutoCloseController`; a deep link without the marker never arms. `onTouchStart={cancelAutoClose}` remains on the root `KeyboardAvoidingView`.
- `docs/superpowers/specs/2026-11-19-auto-close-after-logout-design.md`: documented the marker requirement, new helpers, deep-link case, and controller fake-timer tests.
- This plan file: records these fixes.

Verified with Node 22 (`PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"`):

- `npm test -- --runInBand` → 12 passed suites, 100 passed tests.
- `npx tsc --noEmit` → only the three pre-existing errors in `src/components/animated-icon.web.tsx`, `src/components/app-tabs.web.tsx`, and `src/constants/theme.ts`; none in touched files.
- `npx expo lint` → unchanged baseline of 67 problems (11 errors, 56 warnings); no new issues in touched lines.
