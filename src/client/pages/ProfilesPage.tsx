import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { profileAvatarChoices, type ProfileAvatarKey } from "../../domain/profile-avatars";
import type { PlayerProfile } from "../../domain/types";
import { Brand } from "../components";
import { ProfileAvatar } from "../ProfileAvatar";
import { usePlayerProfile } from "../player-profile";

type ProfileMode = "select" | "manage" | "create" | "edit";

function ProfileTile({ profile, active, manage, onClick }: { profile: PlayerProfile; active: boolean; manage: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button className={`profile-select-card${active ? " active" : ""}`} type="button" onClick={onClick} data-controller-target>
      <span className="profile-select-art"><ProfileAvatar avatarKey={profile.avatarKey} />{manage && <i aria-hidden="true">✎</i>}</span>
      <strong>{profile.displayName}</strong>
      {manage && <small>{profile.isAdministrator ? "Administrator" : "Player"}</small>}
    </button>
  );
}

function AddProfileTile({ onClick }: { onClick: () => void }): React.JSX.Element {
  return <button className="profile-select-card add-profile-card" type="button" onClick={onClick} data-controller-target><span className="profile-select-art"><i aria-hidden="true">＋</i></span><strong>Add Profile</strong></button>;
}

interface SelectorProps {
  profiles: PlayerProfile[];
  activeProfile: PlayerProfile | null;
  manage: boolean;
  choose: (profile: PlayerProfile) => void;
  add: () => void;
  toggleManage: () => void;
}

function ClassicSelector({ profiles, activeProfile, manage, choose, add, toggleManage }: SelectorProps): React.JSX.Element {
  return <section className="profile-selector classic-selector"><p className="profile-kicker">Home Game Portal</p><h1>{manage ? "Manage Profiles" : "Who’s playing?"}</h1><p>{manage ? "Choose a profile to update its name or avatar." : "Pick your player to keep Saves and Favorites separate."}</p><div className="profile-select-grid">{profiles.map((profile) => <ProfileTile key={profile.key} profile={profile} active={activeProfile?.key === profile.key} manage={manage} onClick={() => choose(profile)} />)}<AddProfileTile onClick={add} /></div><button className="manage-profiles-button" type="button" onClick={toggleManage} data-controller-target>{manage ? "Done" : "Manage Profiles"}</button></section>;
}

function AvatarEditor({ profile, onCancel, onSaved }: { profile: PlayerProfile | null; onCancel: () => void; onSaved: (displayName: string, avatarKey: ProfileAvatarKey) => Promise<void> }): React.JSX.Element {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [avatarKey, setAvatarKey] = useState<ProfileAvatarKey>(profile?.avatarKey ?? "space-pilot");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? "");
    setAvatarKey(profile?.avatarKey ?? "space-pilot");
  }, [profile?.key]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try { await onSaved(displayName, avatarKey); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The Player Profile could not be saved."); }
    finally { setSaving(false); }
  };

  return <section className="profile-editor"><div className="profile-editor-preview"><ProfileAvatar avatarKey={avatarKey} /><p>Player Profile</p><strong>{displayName.trim() || "New Player"}</strong></div><form onSubmit={(event) => { event.preventDefault(); void save(); }}><p className="profile-kicker">{profile ? "Edit Player" : "New Player"}</p><h1>{profile ? "Customize profile" : "Choose your avatar"}</h1><label className="profile-name-field"><span>Player name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} placeholder="Player name" required autoFocus /></label><fieldset><legend>Choose an avatar</legend><div className="avatar-choice-grid">{profileAvatarChoices.map((avatar) => <button key={avatar.key} className={`avatar-choice${avatarKey === avatar.key ? " selected" : ""}`} type="button" onClick={() => setAvatarKey(avatar.key)} aria-pressed={avatarKey === avatar.key} aria-label={`Choose ${avatar.name}`} data-controller-target><ProfileAvatar avatarKey={avatar.key} /><span>{avatar.name}</span></button>)}</div></fieldset>{message && <p className="profile-editor-message" role="alert">{message}</p>}<div className="profile-editor-actions"><button className="stream-button secondary" type="button" onClick={onCancel}>Cancel</button><button className="stream-button primary" type="submit" disabled={saving}>{saving ? "Saving…" : profile ? "Save Profile" : "Create Profile"}</button></div></form></section>;
}

export function ProfilesPage(): React.JSX.Element {
  const { profiles, activeProfile, loading, selectProfile, createProfile, updateProfile } = usePlayerProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawMode = searchParams.get("mode");
  const mode: ProfileMode = rawMode === "manage" || rawMode === "create" || rawMode === "edit" ? rawMode : "select";
  const editingProfile = profiles.find((profile) => profile.key === searchParams.get("profile")) ?? null;
  const setMode = (nextMode: ProfileMode, profileKey?: string) => {
    const params = new URLSearchParams(searchParams);
    if (nextMode === "select") params.delete("mode"); else params.set("mode", nextMode);
    if (profileKey) params.set("profile", profileKey); else params.delete("profile");
    setSearchParams(params);
  };
  const choose = (profile: PlayerProfile) => {
    if (mode === "manage") return setMode("edit", profile.key);
    selectProfile(profile.key); navigate("/");
  };
  const selectorProps: SelectorProps = { profiles, activeProfile, manage: mode === "manage", choose, add: () => setMode("create"), toggleManage: () => setMode(mode === "manage" ? "select" : "manage") };

  if (loading) return <main className="profiles-page"><div className="profiles-brand"><Brand /></div><p className="profiles-loading">Loading Player Profiles…</p></main>;
  return <main className="profiles-page"><header className="profiles-topbar"><Link to="/" aria-label="Browse Home Game Portal"><Brand /></Link><div><Link to="/settings" data-controller-target>Settings</Link><Link to="/" data-controller-target>Close</Link></div></header>{mode === "create" || mode === "edit" ? <AvatarEditor profile={mode === "edit" ? editingProfile : null} onCancel={() => setMode(mode === "edit" ? "manage" : "select")} onSaved={async (displayName, avatarKey) => { if (mode === "edit" && editingProfile) { await updateProfile(editingProfile.key, displayName, avatarKey); setMode("manage"); } else { await createProfile(displayName, avatarKey); navigate("/"); } }} /> : <ClassicSelector {...selectorProps} />}</main>;
}
