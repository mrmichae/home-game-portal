import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { GameSummary } from "../domain/types";
import { usePlayerProfile } from "./player-profile";
import { ProfileAvatar } from "./ProfileAvatar";
import { primaryNavigationIsActive, type PrimaryNavigationKey } from "./primary-navigation";

export function Brand(): React.JSX.Element {
  return (
    <div className="brand" aria-label="Home Game Portal">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>Home Game <b>Portal</b></span>
    </div>
  );
}

export function PortalHeader(): React.JSX.Element {
  const { activeProfile } = usePlayerProfile();
  const location = useLocation();
  const navigation: { key: PrimaryNavigationKey; label: string; to: string }[] = [
    { key: "browse", label: "Browse", to: "/" },
    { key: "collections", label: "Collections", to: "/collections" },
    { key: "library", label: "My Library", to: "/library" },
    { key: "settings", label: "Settings", to: "/settings" },
  ];
  return (
    <header className="stream-header">
      <Link to="/" aria-label="Browse Home Game Portal"><Brand /></Link>
      <nav className="navigation-pills" aria-label="Primary">{navigation.map((item) => {
        const selected = primaryNavigationIsActive(item.key, location.pathname);
        return <Link key={item.key} className={`navigation-pill${selected ? " selected" : ""}`} to={item.to} aria-current={selected ? "page" : undefined} data-controller-target>{item.label}</Link>;
      })}</nav>
      <div className="header-tools">
        <Link className="header-search" to="/search" data-controller-target><span aria-hidden="true">⌕</span> Search</Link>
        {activeProfile && <Link className="profile-chip" to="/profiles" aria-label={`Player Profile: ${activeProfile.displayName}`} title={`Player Profile: ${activeProfile.displayName}`} data-controller-target><ProfileAvatar avatarKey={activeProfile.avatarKey} /><b>{activeProfile.displayName}</b></Link>}
      </div>
    </header>
  );
}

export function GameArtwork({ game, large = false }: { game: GameSummary; large?: boolean }): React.JSX.Element {
  const hue = Number.parseInt(game.id.slice(0, 4), 16) % 360;
  const initials = game.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("en-US");
  return (
    <div className={`game-artwork${large ? " game-artwork-large" : ""}`} data-platform={game.platform} style={{ "--game-hue": hue } as React.CSSProperties}>
      <div className="cartridge-ridges" aria-hidden="true" />
      <div className="cartridge-label">
        <span className="cartridge-system">{game.platform === "snes" ? "Super Nintendo" : "Entertainment System"}</span>
        <strong aria-hidden="true">{initials}</strong>
        <span>{game.displayName}</span>
      </div>
      <div className="cartridge-grip" aria-hidden="true" />
    </div>
  );
}

export function CoverArt({ game, eager = false }: { game: GameSummary; eager?: boolean }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) return <GameArtwork game={game} />;
  return (
    <img
      className="cover-art"
      src={game.coverUrl}
      alt={`${game.displayName} cover art`}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailed(true)}
    />
  );
}

export function GamePosterCard({ game }: { game: GameSummary }): React.JSX.Element {
  return (
    <Link className="poster-card" to={`/games/${game.id}`} data-controller-target>
      <div className="poster-image"><CoverArt game={game} />{game.hasServerSave && <span className="progress-badge">Continue</span>}{game.isFavorite && <span className="favorite-badge" aria-label="Favorite">♥</span>}</div>
      <strong>{game.displayName}</strong><small>{game.releaseYear} · {game.genres[0]}</small>
    </Link>
  );
}

export function ControllerGlyph(): React.JSX.Element {
  return (
    <svg className="controller-glyph" viewBox="0 0 96 54" aria-hidden="true">
      <path d="M8 7h80a5 5 0 0 1 5 5v30a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V12a5 5 0 0 1 5-5Z" />
      <path d="M19 18h7v7h7v7h-7v7h-7v-7h-7v-7h7Z" />
      <circle cx="72" cy="24" r="5" /><circle cx="83" cy="34" r="5" />
      <path d="M42 31h9M55 31h9" />
    </svg>
  );
}

export function Spinner(): React.JSX.Element {
  return <span className="spinner" aria-label="Loading" />;
}
