import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ControllerPresetKey, PlayerProfile } from "../domain/types";
import { api } from "./api";
import { readActiveProfileKey, writeActiveProfileKey } from "./profile-storage";
import type { ProfileAvatarKey } from "../domain/profile-avatars";

interface PlayerProfileContextValue {
  profiles: PlayerProfile[];
  activeProfile: PlayerProfile | null;
  featuredSeed: number;
  loading: boolean;
  selectProfile: (profileKey: string) => void;
  createProfile: (displayName: string, avatarKey: ProfileAvatarKey) => Promise<PlayerProfile>;
  updateProfile: (profileKey: string, displayName: string, avatarKey: ProfileAvatarKey) => Promise<PlayerProfile>;
  savePreferences: (themeKey: string, accentColor: string) => Promise<void>;
  setControllerPreset: (controllerPreset: ControllerPresetKey) => Promise<void>;
}

const PlayerProfileContext = createContext<PlayerProfileContextValue | null>(null);

export function PlayerProfileProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [activeKey, setActiveKey] = useState(readActiveProfileKey);
  const [loading, setLoading] = useState(true);
  const [featuredSeed, setFeaturedSeed] = useState(() => Date.now() % 2_147_483_647);

  useEffect(() => {
    void api.profiles().then(({ profiles: found }) => {
      setProfiles(found);
      if (!found.some((profile) => profile.key === activeKey)) {
        setActiveKey("household");
        writeActiveProfileKey("household");
      }
    }).finally(() => setLoading(false));
  }, []);

  const activeProfile = profiles.find((profile) => profile.key === activeKey) ?? null;
  const selectProfile = (profileKey: string) => {
    if (!profiles.some((profile) => profile.key === profileKey)) return;
    writeActiveProfileKey(profileKey);
    setActiveKey(profileKey);
    setFeaturedSeed((current) => current + 1);
  };
  const createProfile = async (displayName: string, avatarKey: ProfileAvatarKey) => {
    const { profile } = await api.createProfile(displayName, avatarKey);
    setProfiles((current) => [...current, profile]);
    writeActiveProfileKey(profile.key);
    setActiveKey(profile.key);
    setFeaturedSeed((current) => current + 1);
    return profile;
  };
  const updateProfile = async (profileKey: string, displayName: string, avatarKey: ProfileAvatarKey) => {
    const { profile } = await api.updateProfile(profileKey, displayName, avatarKey);
    setProfiles((current) => current.map((item) => item.key === profile.key ? profile : item));
    return profile;
  };
  const savePreferences = async (themeKey: string, accentColor: string) => {
    if (!activeProfile) return;
    const { profile } = await api.updateProfilePreferences(activeProfile.key, themeKey, accentColor);
    setProfiles((current) => current.map((item) => item.key === profile.key ? profile : item));
  };
  const setControllerPreset = async (controllerPreset: ControllerPresetKey) => {
    if (!activeProfile) return;
    const { profile } = await api.updateProfileController(activeProfile.key, controllerPreset);
    setProfiles((current) => current.map((item) => item.key === profile.key ? profile : item));
  };
  const value = useMemo(() => ({ profiles, activeProfile, featuredSeed, loading, selectProfile, createProfile, updateProfile, savePreferences, setControllerPreset }), [profiles, activeProfile, featuredSeed, loading]);
  return <PlayerProfileContext.Provider value={value}>{children}</PlayerProfileContext.Provider>;
}

export function usePlayerProfile(): PlayerProfileContextValue {
  const context = useContext(PlayerProfileContext);
  if (!context) throw new Error("usePlayerProfile must be used inside PlayerProfileProvider.");
  return context;
}
