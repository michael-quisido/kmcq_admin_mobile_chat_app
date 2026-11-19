export const LOGOUT_CLOSE_PARAM = "closeAfterLogout";

export function isLogoutCloseParam(
  value: string | string[] | null | undefined,
): boolean {
  return value === "1";
}
