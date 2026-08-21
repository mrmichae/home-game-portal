const ACTIVE_PROFILE_KEY = "portal-player-profile";

export function readActiveProfileKey(): string {
  return localStorage.getItem(ACTIVE_PROFILE_KEY) ?? "household";
}

export function writeActiveProfileKey(profileKey: string): void {
  localStorage.setItem(ACTIVE_PROFILE_KEY, profileKey);
}
