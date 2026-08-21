import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GameDetail } from "../../domain/types";
import { api } from "../api";
import { CoverArt, PortalHeader, Spinner } from "../components";
import { useCatalog } from "../use-catalog";
import { usePlayerProfile } from "../player-profile";

export function MetadataAdminPage(): React.JSX.Element {
  const { games, loading, message } = useCatalog();
  const { activeProfile } = usePlayerProfile();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("game") ?? games[0]?.id ?? "";
  const selectedSummary = games.find((game) => game.id === selectedId) ?? games[0];
  const [game, setGame] = useState<GameDetail | null>(null);
  const [form, setForm] = useState({ displayName: "", releaseYear: "", description: "", genres: "", series: "", coverUrl: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const filteredGames = useMemo(() => games.filter((item) => item.displayName.toLocaleLowerCase("en-US").includes(filter.toLocaleLowerCase("en-US"))), [games, filter]);

  useEffect(() => {
    if (!selectedSummary) return;
    setStatus(null);
    void api.game(selectedSummary.id).then(({ game: detail }) => {
      setGame(detail);
      setForm({ displayName: detail.displayName, releaseYear: String(detail.releaseYear), description: detail.description, genres: detail.genres.join(", "), series: detail.series ?? "", coverUrl: detail.artworkSourceUrl });
    });
  }, [selectedSummary?.id]);

  const chooseGame = (gameId: string) => {
    const next = new URLSearchParams(params);
    next.set("game", gameId);
    setParams(next, { replace: true });
  };
  const save = async () => {
    if (!game) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await api.correctMetadata(game.id, { displayName: form.displayName, releaseYear: Number.parseInt(form.releaseYear, 10), description: form.description, genres: form.genres.split(","), series: form.series || null, coverUrl: form.coverUrl || null });
      setGame(result.game);
      setStatus("Metadata Match correction saved. It will survive rescans.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Metadata Match correction could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    if (!game) return;
    setSaving(true);
    try {
      const result = await api.resetMetadata(game.id);
      setGame(result.game);
      setForm({ displayName: result.game.displayName, releaseYear: String(result.game.releaseYear), description: result.game.description, genres: result.game.genres.join(", "), series: result.game.series ?? "", coverUrl: result.game.artworkSourceUrl });
      setStatus("Correction removed. Filename and curated metadata restored.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="stream-shell"><PortalHeader /><section className="stream-loading"><Spinner /><h1>Opening Metadata Matches…</h1></section></main>;
  if (activeProfile && !activeProfile.isAdministrator) return <main className="stream-shell"><PortalHeader /><section className="collection-state"><h1>Administrator access is required</h1><Link className="stream-button primary" to="/settings#profiles">Switch Player Profile</Link></section></main>;
  if (message || !selectedSummary) return <main className="stream-shell"><PortalHeader /><section className="collection-state"><h1>Metadata Matches are unavailable</h1><p>{message}</p></section></main>;
  return (
    <main className="stream-shell metadata-admin-page">
      <PortalHeader />
      <section className="admin-heading"><div><p className="stream-kicker">Administrator</p><h1>Metadata Matches</h1><p>Correct presentation metadata without renaming or changing a source Game File.</p></div><Link className="stream-button secondary" to="/settings">← Settings</Link></section>
      <div className="metadata-workspace">
        <aside className="metadata-game-list"><label><span>Find a Game</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter library" /></label><div>{filteredGames.map((item) => <button key={item.id} className={item.id === selectedSummary.id ? "selected" : ""} onClick={() => chooseGame(item.id)} data-controller-target><span>{item.displayName}</span><small>{item.releaseYear} · {item.metadataStatus}</small></button>)}</div></aside>
        <section className="metadata-editor">{game ? <><div className="metadata-editor-preview"><div><CoverArt game={game} eager /></div><span><b>{game.metadataStatus === "corrected" ? "Administrator corrected" : game.metadataStatus === "curated" ? "Curated local match" : "Filename match"}</b><small>Source name: {game.sourceDisplayName}</small></span></div><div className="metadata-form"><label><span>Display name</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label><span>Release year</span><input type="number" min="1970" max="2100" value={form.releaseYear} onChange={(event) => setForm({ ...form, releaseYear: event.target.value })} /></label><label className="wide"><span>Description</span><textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label><span>Genres · comma separated</span><input value={form.genres} onChange={(event) => setForm({ ...form, genres: event.target.value })} /></label><label><span>Series</span><input value={form.series} onChange={(event) => setForm({ ...form, series: event.target.value })} /></label><label className="wide"><span>HTTPS artwork URL</span><input type="url" value={form.coverUrl} onChange={(event) => setForm({ ...form, coverUrl: event.target.value })} /></label></div><div className="metadata-actions"><button className="stream-button primary" onClick={() => void save()} disabled={saving} data-controller-target>{saving ? "Saving…" : "Save correction"}</button>{game.metadataStatus === "corrected" && <button className="stream-button secondary" onClick={() => void reset()} disabled={saving} data-controller-target>Reset to match</button>}</div>{status && <p className="settings-message" role="status">{status}</p>}</> : <Spinner />}</section>
      </div>
    </main>
  );
}
