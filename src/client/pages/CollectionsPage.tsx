import { Link, useParams } from "react-router-dom";
import { CoverArt, GamePosterCard, PortalHeader, Spinner } from "../components";
import { useCatalog } from "../use-catalog";

export function CollectionsPage(): React.JSX.Element {
  const { collectionSlug } = useParams();
  const { collections, loading, message } = useCatalog();
  const selected = collections.find((collection) => collection.slug === collectionSlug);
  if (loading) return <main className="stream-shell"><PortalHeader /><section className="stream-loading"><Spinner /><h1>Gathering Collections…</h1></section></main>;
  if (message) return <main className="stream-shell"><PortalHeader /><section className="collection-state"><h1>Collections are unavailable</h1><p>{message}</p></section></main>;
  if (collectionSlug && !selected) return <main className="stream-shell"><PortalHeader /><section className="collection-state"><h1>That Collection isn’t available</h1><Link className="stream-button primary" to="/collections">Browse Collections</Link></section></main>;
  if (selected) {
    return (
      <main className="stream-shell collection-detail">
        <PortalHeader />
        <section className="collection-hero"><div className="collection-hero-covers">{selected.games.slice(0, 3).map((game) => <div key={game.id}><CoverArt game={game} eager /></div>)}</div><div><p className="stream-kicker">Collection</p><h1>{selected.name}</h1><p>{selected.description}</p><span>{selected.games.length} games</span></div></section>
        <section className="collection-games">{selected.games.map((game) => <GamePosterCard key={game.id} game={game} />)}</section>
      </main>
    );
  }
  return (
    <main className="stream-shell collections-page">
      <PortalHeader />
      <section className="collections-heading"><p className="stream-kicker">Explore connected worlds</p><h1>Collections</h1><p>Choose a Collection to browse its games. The Household administrator can edit every Collection and create new ones.</p></section>
      <section className="collection-grid">{collections.map((collection) => <Link className="collection-card" key={collection.slug} to={`/collections/${collection.slug}`} data-controller-target><div className="collection-covers">{collection.games.slice(0, 3).map((game) => <div key={game.id}><CoverArt game={game} /></div>)}</div><div className="collection-card-copy"><span>Collection</span><h2>{collection.name}</h2><p>{collection.games.length} games</p></div></Link>)}</section>
    </main>
  );
}
