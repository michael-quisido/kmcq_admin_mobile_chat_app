export const LOGOUT_CLOSE_PARAM = "closeAfterLogout";
export const LOGOUT_CLOSE_VALUE = "1";
export const LOGOUT_CLOSE_DELAY_MS = 1800;

let logoutClosePending = false;

export function isLogoutCloseParam(
  value: string | string[] | null | undefined,
): boolean {
  return value === LOGOUT_CLOSE_VALUE;
}

export function markLogoutClosePending(): void {
  logoutClosePending = true;
}

export function consumeLogoutClosePending(): boolean {
  const pending = logoutClosePending;
  logoutClosePending = false;
  return pending;
}

export interface LogoutAutoCloseController {
  arm: () => void;
  cancel: () => void;
}

export function createLogoutAutoCloseController({
  isAndroid,
  onExit,
  delayMs = LOGOUT_CLOSE_DELAY_MS,
}: {
  isAndroid: boolean;
  onExit: () => void;
  delayMs?: number;
}): LogoutAutoCloseController {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    arm() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        if (isAndroid) onExit();
      }, delayMs);
    },
    cancel,
  };
}
