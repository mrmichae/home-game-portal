import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { GamePosterCard, PortalHeader, Spinner } from "../components";
import { filterLibraryByPlatform, libraryPlatformFilterOptions, librarySortOptions, parseLibraryPlatformFilter, parseLibrarySort, sortLibrary } from "../library-sort";
import { useCatalog } from "../use-catalog";

export function LibraryPage(): React.JSX.Element {
  const { games, loading, message } = useCatalog();
  const [params, setParams] = useSearchParams();
  const sort = parseLibrarySort(params.get("sort"));
  const platform = parseLibraryPlatformFilter(params.get("platform"));
  const visibleGames = useMemo(() => filterLibraryByPlatform(games, platform), [games, platform]);
  const sortedGames = useMemo(() => sortLibrary(visibleGames, sort), [visibleGames, sort]);
  const selectSort = (nextSort: string) => {
    const next = new URLSearchParams(params);
    nextSort === "a-z" ? next.delete("sort") : next.set("sort", nextSort);
    setParams(next, { replace: true });
  };
  const selectPlatform = (nextPlatform: string) => {
    const next = new URLSearchParams(params);
    nextPlatform === "all" ? next.delete("platform") : next.set("platform", nextPlatform);
    setParams(next, { replace: true });
  };
  const selectedPlatformLabel = libraryPlatformFilterOptions.find((option) => option.key === platform)?.label ?? "All platforms";

  return (
    <main className="stream-shell library-page">
      <PortalHeader />
      <section className="library-heading">
        <div><p className="stream-kicker">NES · Super Nintendo · Atari 2600</p><h1>My Library</h1><p>{visibleGames.length}{platform === "all" ? "" : ` of ${games.length}`} {visibleGames.length === 1 ? "Game" : "Games"} · {selectedPlatformLabel}</p></div>
        <div className="library-controls">
          <label className="sort-control"><span>Platform</span><select value={platform} onChange={(event) => selectPlatform(event.target.value)} aria-label="Filter games by platform">{libraryPlatformFilterOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          <label className="sort-control"><span>Sort by</span><select value={sort} onChange={(event) => selectSort(event.target.value)} aria-label="Sort games">{librarySortOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        </div>
      </section>
      {loading ? <section className="stream-loading compact"><Spinner /><h1>Opening your library…</h1></section> : message ? <section className="search-empty"><h1>Your library is unavailable</h1><p>{message}</p></section> : sortedGames.length === 0 ? <section className="search-empty"><h1>No {selectedPlatformLabel} games</h1><p>Choose another platform or rescan your Library Source after adding games.</p></section> : <section className="library-grid" aria-label={`${selectedPlatformLabel} games sorted ${librarySortOptions.find((option) => option.key === sort)?.label}`}>{sortedGames.map((game) => <GamePosterCard key={game.id} game={game} />)}</section>}
    </main>
  );
}
