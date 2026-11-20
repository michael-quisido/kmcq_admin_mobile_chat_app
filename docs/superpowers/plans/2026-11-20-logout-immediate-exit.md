# Logout Immediately Exits App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a successful LiveChat logout exit the Android app immediately without navigating to Login, and remove the old delayed-close flow.

**Architecture:** `handleLogout` in `src/app/livechat.tsx` keeps local cleanup, awaits the logout API, then calls `BackHandler.exitApp()` directly on Android. On failure it alerts and stays on LiveChat. Login auto-close wiring, the helper module, helper tests, and stale plan documentation are deleted.

**Tech Stack:** Expo Router `~58.0.30`, React Native `0.88.1`, Jest via `jest-expo`, TypeScript.

---

### Task 1: Exit Android directly after successful logout

**Files:**
- Modify: `src/app/livechat.tsx:2-23` (imports)
- Modify: `src/app/livechat.tsx:342-358` (`handleLogout`)

- [ ] **Step 1: Add the `BackHandler` import**

In `src/app/livechat.tsx`, replace:

```ts
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
```

with:

```ts
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
```

- [ ] **Step 2: Remove the obsolete auto-close helper import**

In `src/app/livechat.tsx`, delete this entire import block:

```ts
import {
  LOGOUT_CLOSE_PARAM,
  LOGOUT_CLOSE_VALUE,
  markLogoutClosePending,
} from "../lib/logoutAutoClose";
```

After deletion, `import api from "../lib/api";` is followed directly by `import { Conversation, fetchConversations } from "../lib/livechat/conversations";`.

- [ ] **Step 3: Replace `handleLogout`**

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
      if (Platform.OS === "android") {
        BackHandler.exitApp();
      }
    } catch (error: any) {
      Alert.alert("Error", error.response?.data?.error || "Failed to log out");
    }
  };
```

There must be no `router.replace` call in this function. On iOS/web, the function ends after a successful API call and the user remains on LiveChat.

- [ ] **Step 4: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: only the three pre-existing unrelated errors in `src/components/animated-icon.web.tsx`, `src/components/app-tabs.web.tsx`, and `src/constants/theme.ts`. No error in `src/app/livechat.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/app/livechat.tsx
git commit -m "feat: exit immediately after successful logout"
```

---

### Task 2: Remove Login auto-close wiring

**Files:**
- Modify: `src/app/login.tsx:1-24` (imports)
- Modify: `src/app/login.tsx:26-54` (state/effect)
- Modify: `src/app/login.tsx:92-97` (root view)

- [ ] **Step 1: Restore simple imports**

In `src/app/login.tsx`, replace lines 1-24 with:

```ts
import React, { useState } from "react";
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
} from "react-native";
import api from "../lib/api";
import { routeAfterAuthentication } from "../lib/notifications/authRouting";
```

- [ ] **Step 2: Remove auto-close state and effect**

In `src/app/login.tsx`, delete this entire block after the existing `loading` state:

```ts
  const params = useLocalSearchParams<{ closeAfterLogout?: string }>();
  const autoCloseControllerRef = useRef<LogoutAutoCloseController | null>(null);
  const autoCloseArmedRef = useRef(isLogoutCloseParam(params.closeAfterLogout));

  const cancelAutoClose = useCallback(() => {
    autoCloseControllerRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (!autoCloseArmedRef.current) return;
    if (!consumeLogoutClosePending()) return;

    router.setParams({ [LOGOUT_CLOSE_PARAM]: undefined });
    autoCloseControllerRef.current = createLogoutAutoCloseController({
      isAndroid: Platform.OS === "android",
      onExit: () => BackHandler.exitApp(),
    });
    autoCloseControllerRef.current.arm();

    return cancelAutoClose;
  }, [cancelAutoClose]);
```

The `LoginScreen` component must then go directly from the `loading` state to `sendCode`.

- [ ] **Step 3: Remove the root touch handler**

In `src/app/login.tsx`, replace:

```tsx
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      onTouchStart={cancelAutoClose}
    >
```

with:

```tsx
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
```

- [ ] **Step 4: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: only the three pre-existing unrelated errors listed in Task 1. No error in `src/app/login.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/app/login.tsx
git commit -m "refactor: remove login auto-close flow"
```

---

### Task 3: Delete obsolete helper, tests, and stale plan

**Files:**
- Delete: `src/lib/logoutAutoClose.ts`
- Delete: `src/lib/__tests__/logoutAutoClose.test.ts`
- Delete: `docs/superpowers/plans/2026-11-19-auto-close-after-logout.md`

- [ ] **Step 1: Delete the files**

Run:

```bash
git rm src/lib/logoutAutoClose.ts src/lib/__tests__/logoutAutoClose.test.ts docs/superpowers/plans/2026-11-19-auto-close-after-logout.md
```

- [ ] **Step 2: Verify no remaining references**

Run:

```bash
grep -R "logoutAutoClose\|closeAfterLogout\|LOGOUT_CLOSE" src --include='*.ts' --include='*.tsx' || true
```

Expected: no output.

- [ ] **Step 3: Run unit tests**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS, `11 passed suites`, `93 passed tests`. The deleted helper test accounted for one suite and seven tests.

- [ ] **Step 4: Commit**

```bash
git commit -m "test: remove obsolete auto-close helper tests"
```

---

### Task 4: Verify and smoke-test the completed flow

**Files:** none.

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS, `11 passed suites`, `93 passed tests`.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: only the three pre-existing unrelated errors in `animated-icon.web.tsx`, `app-tabs.web.tsx`, and `theme.ts`. No errors in touched files.

- [ ] **Step 3: Run lint**

Run:

```bash
npx expo lint
```

Expected: no new warnings or errors in `src/app/livechat.tsx` or `src/app/login.tsx`. Pre-existing repo-wide problems may remain.

- [ ] **Step 4: Manual smoke tests**

Verify on device/build with a live backend:

1. Android, successful logout -> app exits immediately; Login screen never appears.
2. Android, failing logout -> error alert appears and app stays on LiveChat.
3. iOS/web, successful logout -> app stays on LiveChat; no Login screen.
4. Fresh app start -> Login screen works normally.

- [ ] **Step 5: Check final git state**

Run:

```bash
git status --short
```

Expected: no modified tracked files. Do not stage or push `google-services.json`, `src/app/google-services.json`, or any Firebase admin SDK JSON.

---

## Self-review checklist

- [x] Spec requirement: immediate Android exit on success -> Task 1.
- [x] Spec requirement: no Login navigation -> Task 1.
- [x] Spec requirement: iOS/web stay on LiveChat -> Task 1.
- [x] Spec requirement: failure alert and stay -> Task 1.
- [x] Spec requirement: remove Login wiring -> Task 2.
- [x] Spec requirement: delete helper and tests -> Task 3.
- [x] Spec requirement: delete stale spec -> already committed before this plan.
- [x] Spec verification commands -> Task 4.
- [x] No placeholders; all code and commands shown inline.
- [x] Names consistent: `BackHandler.exitApp()`, `Platform.OS`, `handleLogout`.
