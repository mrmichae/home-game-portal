import { profileAvatarChoice, profileAvatarSpriteStyle, type ProfileAvatarKey } from "../domain/profile-avatars";

export function ProfileAvatar({ avatarKey, className = "" }: { avatarKey: ProfileAvatarKey; className?: string }): React.JSX.Element {
  const avatar = profileAvatarChoice(avatarKey);
  const sprite = profileAvatarSpriteStyle(avatarKey);
  return (
    <span
      className={`profile-avatar-art ${className}`.trim()}
      role="img"
      aria-label={avatar.name}
      style={{ "--avatar-position": sprite.backgroundPosition, "--avatar-sheet-size": sprite.backgroundSize, "--avatar-color": avatar.color } as React.CSSProperties}
    />
  );
}
