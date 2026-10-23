// The access key predates refresh tokens, so a session saved before they were stored
// still loads, as an access-only session (it can't be refreshed once the access expires).
const ACCESS_KEY = "fyp_access_token";
const REFRESH_KEY = "fyp_refresh_token";

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function getAccessToken(): string {
  return storage()?.getItem(ACCESS_KEY) ?? "";
}

export function getRefreshToken(): string {
  return storage()?.getItem(REFRESH_KEY) ?? "";
}

export function hasSession(): boolean {
  return Boolean(getAccessToken() || getRefreshToken());
}

export function setSession(tokens: { access: string; refresh: string }): void {
  const store = storage();
  if (!store) {
    return;
  }
  store.setItem(ACCESS_KEY, tokens.access);
  store.setItem(REFRESH_KEY, tokens.refresh);
}

export function setAccessToken(access: string): void {
  storage()?.setItem(ACCESS_KEY, access);
}

export function clearSession(): void {
  const store = storage();
  if (!store) {
    return;
  }
  store.removeItem(ACCESS_KEY);
  store.removeItem(REFRESH_KEY);
}
