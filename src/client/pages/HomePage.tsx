import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BrowseRow, GameSummary } from "../../domain/types";
import { selectFeaturedGame } from "../../domain/catalog-presentation";
import { platformShortName } from "../../domain/platforms";
import { api, type CatalogResponse } from "../api";
import { CoverArt, GamePosterCard, PortalHeader, Spinner } from "../components";
import { usePlayerProfile } from "../player-profile";

interface VariantProps {
  featured: GameSummary;
  browseRows: BrowseRow[];
  message: string | null;
  removeFromContinue: (game: GameSummary) => void;
}

export function HomePage(): React.JSX.Element {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<GameSummary | null>(null);
  const [removing, setRemoving] = useState(false);
  const { featuredSeed } = usePlayerProfile();

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await api.catalog());
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The library could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const games = catalog?.shelf.games ?? [];
  const featured = useMemo(() => selectFeaturedGame(games, featuredSeed), [games, featuredSeed]);

  if (loading) {
    return <main className="stream-shell"><PortalHeader /><LoadingLibrary /></main>;
  }
  if (!featured) {
    return (
      <main className="stream-shell">
        <PortalHeader />
        <section className="empty-library"><span className="empty-library-icon">＋</span><h1>Your library is empty</h1><p>Configure a readable ROM Library location, then scan it from Settings.</p><Link className="stream-button primary" to="/settings#library" data-controller-target>Open Library Settings</Link></section>
      </main>
    );
  }

  const removeFromContinue = async () => {
    if (!pendingRemoval) return;
    const previousCatalog = catalog;
    const removedGame = pendingRemoval;
    setRemoving(true);
    setPendingRemoval(null);
    setCatalog((current) => removeGameFromContinuePlaying(current, removedGame.id));
    try {
      await api.removeFromContinuePlaying(removedGame.id);
      setMessage(`${removedGame.displayName} was removed from Continue Playing. Saved progress is still available.`);
    } catch (error) {
      setCatalog(previousCatalog);
      setMessage(error instanceof Error ? error.message : "The game could not be removed from Continue Playing.");
    } finally {
      setRemoving(false);
    }
  };

  const props: VariantProps = { featured, browseRows: catalog?.presentation.browseRows ?? [], message, removeFromContinue: setPendingRemoval };
  return (
    <>
      <CinematicRails {...props} />
      {pendingRemoval && <div className="confirm-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-save-title"><p className="stream-kicker">Remove from Continue Playing</p><h2 id="remove-save-title">Remove {pendingRemoval.displayName} from this shelf?</h2><p>The ROM, metadata, artwork, Favorites, history, Saves, and Checkpoints will all be preserved.</p><div><button className="stream-button secondary" onClick={() => setPendingRemoval(null)} disabled={removing} autoFocus data-controller-target>Cancel</button><button className="stream-button danger" onClick={() => void removeFromContinue()} disabled={removing} data-controller-target>{removing ? "Removing…" : "Remove"}</button></div></section></div>}
    </>
  );
}

export function removeGameFromContinuePlaying(current: CatalogResponse | null, gameId: string): CatalogResponse | null {
  if (!current) return current;
  const updateGame = (game: GameSummary) => game.id === gameId ? { ...game, isContinuePlaying: false } : game;
  return {
    ...current,
    shelf: { ...current.shelf, games: current.shelf.games.map(updateGame) },
    presentation: {
      ...current.presentation,
      collections: current.presentation.collections.map((collection) => ({ ...collection, games: collection.games.map(updateGame) })),
      browseRows: current.presentation.browseRows.map((row) => ({
        ...row,
        games: row.rule.type === "continue" ? row.games.filter((game) => game.id !== gameId) : row.games.map(updateGame),
      })),
    },
  };
}

function LoadingLibrary(): React.JSX.Element {
  return <section className="stream-loading"><Spinner /><h1>Loading your library…</h1></section>;
}

function CinematicRails({ featured, browseRows, message, removeFromContinue }: VariantProps): React.JSX.Element {
  return (
    <main className="stream-shell cinematic-variant" id="browse">
      <PortalHeader />
      <FeaturedHero game={featured} />
      <div className="stream-content">
        {message && <div className="stream-notice" role="status">{message}</div>}
        {browseRows.map((row) => <GameRail key={row.id} id={row.rule.type === "continue" ? "continue" : row.rule.type === "all" ? "all-games" : undefined} title={row.title} games={row.games} onRemove={row.rule.type === "continue" ? removeFromContinue : undefined} />)}
      </div>
    </main>
  );
}

function FeaturedHero({ game }: { game: GameSummary }): React.JSX.Element {
  return (
    <section className="featured-hero" aria-label={`Featured game: ${game.displayName}`}>
      <div className="hero-backdrop"><CoverArt game={game} eager /></div>
      <div className="hero-copy"><p className="stream-kicker">Featured from your library</p><GameMetadata game={game} /><HeroActions game={game} /></div>
    </section>
  );
}

function GameMetadata({ game }: { game: GameSummary }): React.JSX.Element {
  return <><h1>{game.displayName}</h1><div className="metadata-line"><span>{game.releaseYear}</span><span>{platformShortName(game.platform)}</span><span>{game.genres.slice(0, 2).join(" · ")}</span></div><p className="game-description">{game.description}</p></>;
}

function HeroActions({ game }: { game: GameSummary }): React.JSX.Element {
  return <div className="hero-actions"><Link className="stream-button primary" to={`/play/${game.id}`} data-controller-target>▶ {game.hasServerSave ? "Continue" : "Play"}</Link><Link className="stream-button secondary" to={`/games/${game.id}`} data-controller-target>ⓘ More Info</Link></div>;
}

function GameRail({ title, games, id, onRemove }: { title: string; games: GameSummary[]; id?: string; onRemove?: (game: GameSummary) => void }): React.JSX.Element | null {
  if (games.length === 0) return null;
  return <section className="game-rail" id={id}><h2>{title}</h2><div className="rail-track" role="list">{games.map((game) => onRemove ? <div className="continue-card" key={game.id} role="listitem"><GamePosterCard game={game} /><button className="remove-continue" type="button" aria-label={`Remove ${game.displayName} from Continue Playing`} title="Remove from Continue Playing" onClick={() => onRemove(game)} data-controller-target>×</button></div> : <GamePosterCard key={game.id} game={game} />)}</div></section>;
}
