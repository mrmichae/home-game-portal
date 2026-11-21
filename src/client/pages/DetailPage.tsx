import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { GameDetail, SavedState } from "../../domain/types";
import { artworkOrientation, platformShortName } from "../../domain/platforms";
import { api } from "../api";
import { Brand, CoverArt, Spinner } from "../components";
import { continuePlayingRemovalLabel } from "../continue-playing";
import { usePlayerProfile } from "../player-profile";

export function DetailPage(): React.JSX.Element {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const { activeProfile } = usePlayerProfile();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [continuePending, setContinuePending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [savedStates, setSavedStates] = useState<SavedState[]>([]);
  const [savedStatePending, setSavedStatePending] = useState<string | null>(null);

  useEffect(() => {
    void api.game(gameId).then(({ game: found }) => setGame(found)).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "That game could not be opened.");
    });
    void api.savedStates(gameId).then(({ savedStates: found }) => setSavedStates(found)).catch((error: unknown) => {
      setActionMessage(error instanceof Error ? error.message : "Saved states could not be loaded.");
    });
  }, [activeProfile?.key, gameId]);

  const play = () => {
    setLaunching(true);
    navigate(`/play/${gameId}`);
  };

  const loadSavedState = (savedStateId: string) => {
    setLaunching(true);
    navigate(`/play/${gameId}?savedState=${encodeURIComponent(savedStateId)}`);
  };

  const renameSavedState = async (savedState: SavedState) => {
    const label = window.prompt("Name this saved state", savedState.label ?? "");
    if (label === null) return;
    setSavedStatePending(savedState.id);
    try {
      const result = await api.renameSavedState(gameId, savedState.id, label);
      setSavedStates((current) => current.map((item) => item.id === savedState.id ? result.savedState : item));
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "The saved state could not be renamed.");
    } finally {
      setSavedStatePending(null);
    }
  };

  const deleteSavedState = async (savedState: SavedState) => {
    if (!window.confirm("Delete this saved state? Automatic Continue Playing progress will not be affected.")) return;
    setSavedStatePending(savedState.id);
    try {
      await api.deleteSavedState(gameId, savedState.id);
      setSavedStates((current) => current.filter((item) => item.id !== savedState.id));
      setActionMessage("Saved state deleted. Continue Playing progress was not changed.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "The saved state could not be deleted.");
    } finally {
      setSavedStatePending(null);
    }
  };

  const toggleFavorite = async () => {
    if (!game || favoritePending) return;
    setFavoritePending(true);
    setActionMessage(null);
    try {
      const result = await api.favorite(game.id, !game.isFavorite);
      setGame(result.game);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Favorites could not be updated.");
    } finally {
      setFavoritePending(false);
    }
  };

  const removeFromContinuePlaying = async () => {
    if (!game || continuePending) return;
    const previousGame = game;
    setContinuePending(true);
    setActionMessage(null);
    setGame({ ...game, isContinuePlaying: false });
    try {
      const result = await api.removeFromContinuePlaying(game.id);
      setGame(result.game);
      setActionMessage("Removed from Continue Playing. Your saved progress is still available.");
    } catch (error) {
      setGame(previousGame);
      setActionMessage(error instanceof Error ? error.message : "The game could not be removed from Continue Playing.");
    } finally {
      setContinuePending(false);
    }
  };

  if (message) {
    return <main className="stream-shell"><DetailHeader /><section className="detail-state"><p>Couldn’t open game</p><h1>{message}</h1><Link className="stream-button primary" to="/">Back to browse</Link></section></main>;
  }
  if (!game) {
    return <main className="stream-shell"><DetailHeader /><section className="stream-loading"><Spinner /><h1>Loading details…</h1></section></main>;
  }

  return (
    <main className="stream-shell streaming-detail">
      <DetailHeader />
      <section className="detail-feature" data-artwork-orientation={artworkOrientation(game.platform)}>
        <div className="detail-backdrop"><CoverArt game={game} eager /></div>
        <div className="detail-poster" data-artwork-orientation={artworkOrientation(game.platform)}><CoverArt game={game} eager /></div>
        <div className="detail-information">
          <p className="stream-kicker">{game.platformName}</p>
          <h1>{game.displayName}</h1>
          <div className="metadata-line"><span>{game.releaseYear}</span><span>{platformShortName(game.platform)}</span><span>{game.genres.join(" · ")}</span></div>
          <p className="game-description">{game.description}</p>
          <div className="detail-actions">
            <button className="stream-button primary detail-play" onClick={play} disabled={launching} autoFocus data-controller-target>▶ {launching ? "Loading…" : game.hasServerSave ? "Continue Playing" : "Play"}</button>
            <button className={`stream-button secondary favorite-action${game.isFavorite ? " selected" : ""}`} onClick={() => void toggleFavorite()} disabled={favoritePending} data-controller-target>{game.isFavorite ? "♥ In Favorites" : "♡ Add to Favorites"}</button>
            {continuePlayingRemovalLabel(game) && <button className="stream-button secondary remove-continue-action" onClick={() => void removeFromContinuePlaying()} disabled={continuePending} data-controller-target>{continuePending ? "Removing…" : continuePlayingRemovalLabel(game)}</button>}
            {activeProfile?.isAdministrator && <Link className="stream-button secondary" to={`/admin/metadata?game=${game.id}`} data-controller-target>Edit metadata</Link>}
          </div>
          {actionMessage && <p className="detail-action-message" role="status">{actionMessage}</p>}
          <dl className="detail-facts"><div><dt>Platform</dt><dd>{game.platformName}</dd></div><div><dt>Released</dt><dd>{game.releaseYear}</dd></div><div><dt>Progress</dt><dd>{game.hasServerSave ? "Save ready to resume" : "New game"}</dd></div>{game.series && <div><dt>Series</dt><dd>{game.series}</dd></div>}</dl>
          <p className="privacy-note"><span>●</span> Runs privately in this browser. The library source remains read-only.</p>
        </div>
      </section>
      <section className="saved-states-section" aria-labelledby="saved-states-heading">
        <div className="saved-states-heading">
          <div><p className="stream-kicker">Pick up from an exact moment</p><h2 id="saved-states-heading">Saved States</h2></div>
          <span>{savedStates.length} of 10</span>
        </div>
        {savedStates.length ? (
          <div className="saved-states-row">
            {savedStates.map((savedState) => (
              <article className="saved-state-card" key={savedState.id}>
                <button type="button" className="saved-state-load" onClick={() => loadSavedState(savedState.id)} disabled={launching || savedStatePending === savedState.id} data-controller-target>
                  <span className="saved-state-thumbnail">
                    {savedState.thumbnailUrl ? <img src={savedState.thumbnailUrl} alt="" /> : <span className="saved-state-placeholder">No preview</span>}
                    <i aria-hidden="true">▶</i>
                  </span>
                  <strong>{savedState.label || formatSavedStateDate(savedState.createdAt)}</strong>
                  <small>{formatSavedStateTime(savedState.createdAt)}</small>
                </button>
                <div className="saved-state-actions">
                  <button type="button" onClick={() => void renameSavedState(savedState)} disabled={savedStatePending === savedState.id}>Rename</button>
                  <button type="button" className="danger-text" onClick={() => void deleteSavedState(savedState)} disabled={savedStatePending === savedState.id}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="saved-states-empty"><strong>No saved states yet</strong><span>Pause while playing to preserve an exact moment here.</span></div>
        )}
      </section>
    </main>
  );
}

function formatSavedStateDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatSavedStateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function DetailHeader(): React.JSX.Element {
  return <header className="stream-header detail-header"><Link className="header-action detail-back" to="/" aria-label="Back to Browse" data-controller-target><span className="detail-back-arrow" aria-hidden="true">←</span><span className="detail-back-label">Browse</span></Link><Brand /><span aria-hidden="true" /></header>;
}
