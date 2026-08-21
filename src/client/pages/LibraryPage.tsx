import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { GamePosterCard, PortalHeader, Spinner } from "../components";
import { librarySortOptions, parseLibrarySort, sortLibrary } from "../library-sort";
import { useCatalog } from "../use-catalog";

export function LibraryPage(): React.JSX.Element {
  const { games, loading, message } = useCatalog();
  const [params, setParams] = useSearchParams();
  const sort = parseLibrarySort(params.get("sort"));
  const sortedGames = useMemo(() => sortLibrary(games, sort), [games, sort]);
  const selectSort = (nextSort: string) => {
    const next = new URLSearchParams(params);
    nextSort === "a-z" ? next.delete("sort") : next.set("sort", nextSort);
    setParams(next, { replace: true });
  };

  return (
    <main className="stream-shell library-page">
      <PortalHeader />
      <section className="library-heading">
        <div><p className="stream-kicker">Nintendo Entertainment System</p><h1>My Library</h1><p>{games.length} {games.length === 1 ? "Game" : "Games"} · Complete catalog view</p></div>
        <div className="sort-control" aria-label="Sort My Library"><span>Sort by</span><select value={sort} onChange={(event) => selectSort(event.target.value)} aria-label="Sort games">{librarySortOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
      </section>
      {loading ? <section className="stream-loading compact"><Spinner /><h1>Opening your library…</h1></section> : message ? <section className="search-empty"><h1>Your library is unavailable</h1><p>{message}</p></section> : <section className="library-grid" aria-label={`Games sorted ${librarySortOptions.find((option) => option.key === sort)?.label}`}>{sortedGames.map((game) => <GamePosterCard key={game.id} game={game} />)}</section>}
    </main>
  );
}
