import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { searchCatalog } from "../catalog-collections";
import { GamePosterCard, PortalHeader, Spinner } from "../components";
import { useCatalog } from "../use-catalog";

export function SearchPage(): React.JSX.Element {
  const { games, loading, message } = useCatalog();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const results = useMemo(() => searchCatalog(games, query), [games, query]);
  const updateQuery = (value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set("q", value) : next.delete("q");
    setParams(next, { replace: true });
  };
  return (
    <main className="stream-shell search-page">
      <PortalHeader />
      <section className="search-heading">
        <p className="stream-kicker">Find your next game</p>
        <label className="search-box"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={query} onChange={(event) => updateQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") updateQuery(""); }} placeholder="Search titles, genres, platforms, Series…" aria-label="Search your library" /><kbd>ESC</kbd></label>
        {!loading && !message && <p>{query ? `${results.length} ${results.length === 1 ? "match" : "matches"} for “${query}”` : `Search all ${games.length} games in your library`}</p>}
      </section>
      {loading ? <section className="stream-loading compact"><Spinner /><h1>Opening search…</h1></section> : message ? <section className="search-empty"><h1>Search is unavailable</h1><p>{message}</p></section> : results.length > 0 ? <section className="search-results" aria-live="polite">{results.map((game) => <GamePosterCard key={game.id} game={game} />)}</section> : <section className="search-empty"><span>⌕</span><h1>No games found</h1><p>Try a title, Series, genre, or “Nintendo Entertainment System.”</p></section>}
    </main>
  );
}
