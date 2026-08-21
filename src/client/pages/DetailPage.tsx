import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { GameDetail } from "../../domain/types";
import { api } from "../api";
import { Brand, CoverArt, Spinner } from "../components";

export function DetailPage(): React.JSX.Element {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.game(gameId).then(({ game: found }) => setGame(found)).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "That game could not be opened.");
    });
  }, [gameId]);

  const play = () => {
    setLaunching(true);
    navigate(`/play/${gameId}`);
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

  if (message) {
    return <main className="stream-shell"><DetailHeader /><section className="detail-state"><p>Couldn’t open game</p><h1>{message}</h1><Link className="stream-button primary" to="/">Back to browse</Link></section></main>;
  }
  if (!game) {
    return <main className="stream-shell"><DetailHeader /><section className="stream-loading"><Spinner /><h1>Loading details…</h1></section></main>;
  }

  return (
    <main className="stream-shell streaming-detail">
      <DetailHeader />
      <section className="detail-feature">
        <div className="detail-backdrop"><CoverArt game={game} eager /></div>
        <div className="detail-poster"><CoverArt game={game} eager /></div>
        <div className="detail-information">
          <p className="stream-kicker">Nintendo Entertainment System</p>
          <h1>{game.displayName}</h1>
          <div className="metadata-line"><span>{game.releaseYear}</span><span>NES</span><span>{game.genres.join(" · ")}</span></div>
          <p className="game-description">{game.description}</p>
          <div className="detail-actions"><button className="stream-button primary detail-play" onClick={play} disabled={launching} autoFocus data-controller-target>▶ {launching ? "Loading…" : game.hasServerSave ? "Continue Playing" : "Play"}</button><button className={`stream-button secondary favorite-action${game.isFavorite ? " selected" : ""}`} onClick={() => void toggleFavorite()} disabled={favoritePending} data-controller-target>{game.isFavorite ? "♥ In Favorites" : "♡ Add to Favorites"}</button></div>
          {actionMessage && <p className="detail-action-message" role="status">{actionMessage}</p>}
          <dl className="detail-facts"><div><dt>Platform</dt><dd>Nintendo Entertainment System</dd></div><div><dt>Released</dt><dd>{game.releaseYear}</dd></div><div><dt>Progress</dt><dd>{game.hasServerSave ? "Save ready to resume" : "New game"}</dd></div>{game.series && <div><dt>Series</dt><dd>{game.series}</dd></div>}</dl>
          <p className="privacy-note"><span>●</span> Runs privately in this browser. The library source remains read-only.</p>
        </div>
      </section>
    </main>
  );
}

function DetailHeader(): React.JSX.Element {
  return <header className="stream-header detail-header"><Link className="header-action" to="/" data-controller-target>← Browse</Link><Brand /><span aria-hidden="true" /></header>;
}
