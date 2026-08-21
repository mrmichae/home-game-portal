import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { BrowseRowDefinition, BrowseRowInput, BrowseRowRule, CollectionDefinition, CollectionInput, GameSummary, PresentationAdministration } from "../../domain/types";
import { api } from "../api";
import { CoverArt, PortalHeader, Spinner } from "../components";
import { usePlayerProfile } from "../player-profile";

type CollectionDraft = { id: string | null; name: string; description: string; gameIds: string[] };
type RowDraft = { id: string | null; title: string; type: BrowseRowRule["type"]; value: string };
type PendingRemoval = { kind: "collection" | "row"; id: string; name: string };

export function PresentationAdminPage(): React.JSX.Element {
  const { activeProfile } = usePlayerProfile();
  const [administration, setAdministration] = useState<PresentationAdministration | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft | null>(null);
  const [rowDraft, setRowDraft] = useState<RowDraft | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextAdministration, catalog] = await Promise.all([api.presentationAdministration(), api.catalog()]);
      setAdministration(nextAdministration);
      setGames(catalog.shelf.games);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Browse presentation settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (activeProfile?.isAdministrator) void load(); else setLoading(false); }, [activeProfile?.key, activeProfile?.isAdministrator, load]);

  const editCollection = (collection?: CollectionDefinition) => setCollectionDraft(collection
    ? { id: collection.id, name: collection.name, description: collection.description, gameIds: collection.gameIds }
    : { id: null, name: "", description: "", gameIds: [] });
  const editRow = (row?: BrowseRowDefinition) => setRowDraft(row
    ? { id: row.id, title: row.title, type: row.rule.type, value: rowRuleValue(row.rule) }
    : { id: null, title: "", type: "all", value: "" });

  const saveCollection = async (input: CollectionInput) => {
    if (!collectionDraft) return;
    setSaving(true); setMessage("");
    try {
      if (collectionDraft.id) await api.updateCollection(collectionDraft.id, input); else await api.createCollection(input);
      setCollectionDraft(null);
      setMessageKind("success"); setMessage(`Collection ${collectionDraft.id ? "updated" : "created"}.`);
      await load();
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : "Collection could not be saved.");
    } finally { setSaving(false); }
  };

  const saveRow = async (input: BrowseRowInput) => {
    if (!rowDraft) return;
    setSaving(true); setMessage("");
    try {
      if (rowDraft.id) await api.updateBrowseRow(rowDraft.id, input); else await api.createBrowseRow(input);
      setRowDraft(null);
      setMessageKind("success"); setMessage(`Browse Row ${rowDraft.id ? "updated" : "created"}.`);
      await load();
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : "Browse Row could not be saved.");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!pendingRemoval) return;
    setSaving(true); setMessage("");
    try {
      if (pendingRemoval.kind === "collection") await api.deleteCollection(pendingRemoval.id); else await api.deleteBrowseRow(pendingRemoval.id);
      setMessageKind("success"); setMessage(`${pendingRemoval.name} removed.`);
      setPendingRemoval(null);
      await load();
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : "The item could not be removed.");
    } finally { setSaving(false); }
  };

  const moveRow = async (id: string, direction: -1 | 1) => {
    if (!administration) return;
    const ids = administration.browseRows.map((row) => row.id);
    const index = ids.indexOf(id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= ids.length) return;
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    try {
      const { rows } = await api.orderBrowseRows(ids);
      setAdministration({ ...administration, browseRows: rows });
      setMessageKind("success"); setMessage("Browse Row order updated.");
    } catch (error) {
      setMessageKind("error"); setMessage(error instanceof Error ? error.message : "Browse Rows could not be reordered.");
    }
  };

  if (!activeProfile?.isAdministrator) return <main className="stream-shell admin-page"><PortalHeader /><section className="collection-state"><h1>Administrator access required</h1><p>Switch to the Household administrator profile to manage Browse and Collections.</p><Link className="stream-button primary" to="/profiles">Switch Profile</Link></section></main>;
  if (loading) return <main className="stream-shell admin-page"><PortalHeader /><section className="stream-loading"><Spinner /><h1>Loading Browse presentation…</h1></section></main>;
  if (!administration) return <main className="stream-shell admin-page"><PortalHeader /><section className="collection-state"><h1>Presentation settings are unavailable</h1><p>{message}</p><Link className="stream-button secondary" to="/settings">Back to Settings</Link></section></main>;

  return <main className="stream-shell admin-page presentation-admin-page">
    <PortalHeader />
    <section className="admin-heading"><div><p className="stream-kicker">Server administration</p><h1>Browse & Collections</h1><p>Build reusable Collections, then decide which shelves appear on Browse and in what order.</p></div><Link className="stream-button secondary" to="/settings#administration" data-controller-target>← Settings</Link></section>
    {message && <p className={`presentation-status ${messageKind}`} role="status">{message}</p>}
    <section className="presentation-admin-section" aria-labelledby="collections-management-heading">
      <div className="presentation-section-heading"><div><p>Reusable groups</p><h2 id="collections-management-heading">Collections</h2><span>Every Collection is editable. Change its name, description, or games—or create an entirely new group.</span></div><button className="stream-button primary" type="button" onClick={() => editCollection()} data-controller-target>＋ New Collection</button></div>
      {administration.collections.length ? <div className="presentation-list">{administration.collections.map((collection) => <article className="presentation-list-item" key={collection.id}><CollectionMiniCovers gameIds={collection.gameIds} games={games} /><div><span>Collection</span><h3>{collection.name}</h3><p>{collection.description}</p><small>{collection.gameIds.length} {collection.gameIds.length === 1 ? "game" : "games"}</small></div><div className="presentation-item-actions"><button type="button" onClick={() => editCollection(collection)} data-controller-target>Edit</button><button className="danger-text" type="button" onClick={() => setPendingRemoval({ kind: "collection", id: collection.id, name: collection.name })} data-controller-target>Remove</button></div></article>)}</div> : <div className="presentation-empty"><b>No Collections yet.</b><span>Create one to group any combination of games, then optionally feature it as a Browse Row.</span></div>}
    </section>
    <section className="presentation-admin-section" aria-labelledby="browse-rows-heading">
      <div className="presentation-section-heading"><div><p>Browse layout</p><h2 id="browse-rows-heading">Browse Rows</h2><span>Rows are resolved for the active Player Profile, so Favorites, Saves, and recent history stay personal.</span></div><button className="stream-button primary" type="button" onClick={() => editRow()} data-controller-target>＋ New Browse Row</button></div>
      {administration.browseRows.length ? <ol className="browse-row-list">{administration.browseRows.map((row, index) => <li key={row.id}><span className="browse-row-order">{String(index + 1).padStart(2, "0")}</span><div><h3>{row.title}</h3><p>{describeRule(row.rule, administration)}</p></div><div className="browse-row-actions"><button type="button" aria-label={`Move ${row.title} up`} onClick={() => void moveRow(row.id, -1)} disabled={index === 0}>↑</button><button type="button" aria-label={`Move ${row.title} down`} onClick={() => void moveRow(row.id, 1)} disabled={index === administration.browseRows.length - 1}>↓</button><button type="button" onClick={() => editRow(row)}>Edit</button><button className="danger-text" type="button" onClick={() => setPendingRemoval({ kind: "row", id: row.id, name: row.title })}>Remove</button></div></li>)}</ol> : <div className="presentation-empty"><b>Browse has no rows.</b><span>Add a row to give the Browse screen content beneath Featured.</span></div>}
    </section>
    {collectionDraft && <CollectionEditor draft={collectionDraft} games={games} saving={saving} onCancel={() => setCollectionDraft(null)} onSave={saveCollection} />}
    {rowDraft && <BrowseRowEditor draft={rowDraft} collections={administration.collectionOptions} saving={saving} onCancel={() => setRowDraft(null)} onSave={saveRow} />}
    {pendingRemoval && <div className="confirm-backdrop"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-presentation-title"><p className="stream-kicker">Remove {pendingRemoval.kind === "row" ? "Browse Row" : "Collection"}</p><h2 id="remove-presentation-title">Remove {pendingRemoval.name}?</h2><p>{pendingRemoval.kind === "collection" ? "Any Browse Row that points to this Collection will also be removed. Games and Game Files are not affected." : "This removes the shelf from Browse. Collections, games, Saves, and Game Files are not affected."}</p><div><button className="stream-button secondary" type="button" onClick={() => setPendingRemoval(null)} disabled={saving} autoFocus>Cancel</button><button className="stream-button danger" type="button" onClick={() => void remove()} disabled={saving}>{saving ? "Removing…" : "Remove"}</button></div></section></div>}
  </main>;
}

function CollectionEditor({ draft, games, saving, onCancel, onSave }: { draft: CollectionDraft; games: GameSummary[]; saving: boolean; onCancel: () => void; onSave: (input: CollectionInput) => Promise<void> }): React.JSX.Element {
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [gameIds, setGameIds] = useState(draft.gameIds);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => games.filter((game) => game.displayName.toLocaleLowerCase("en-US").includes(query.trim().toLocaleLowerCase("en-US"))), [games, query]);
  const submit = (event: FormEvent) => { event.preventDefault(); void onSave({ name, description, gameIds }); };
  const toggle = (id: string) => setGameIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <div className="presentation-editor-backdrop"><form className="presentation-editor" onSubmit={submit}><header><div><p className="stream-kicker">{draft.id ? "Edit Collection" : "New Collection"}</p><h2>{draft.id ? draft.name : "Build a Collection"}</h2></div><button type="button" aria-label="Close Collection editor" onClick={onCancel}>×</button></header><div className="presentation-fields"><label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} required autoFocus /></label><label><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} rows={3} required /></label></div><div className="collection-game-picker-heading"><div><h3>Choose games</h3><span>{gameIds.length} selected</span></div><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a title…" aria-label="Find a title for this Collection" /></div><div className="collection-game-picker">{filtered.map((game) => <button key={game.id} type="button" className={gameIds.includes(game.id) ? "selected" : ""} onClick={() => toggle(game.id)} aria-pressed={gameIds.includes(game.id)}><span><CoverArt game={game} /></span><b>{game.displayName}</b><i>{gameIds.includes(game.id) ? "✓" : "+"}</i></button>)}</div><footer><button className="stream-button secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button><button className="stream-button primary" type="submit" disabled={saving}>{saving ? "Saving…" : draft.id ? "Save Collection" : "Create Collection"}</button></footer></form></div>;
}

function BrowseRowEditor({ draft, collections, saving, onCancel, onSave }: { draft: RowDraft; collections: PresentationAdministration["collectionOptions"]; saving: boolean; onCancel: () => void; onSave: (input: BrowseRowInput) => Promise<void> }): React.JSX.Element {
  const [title, setTitle] = useState(draft.title);
  const [type, setType] = useState(draft.type);
  const [value, setValue] = useState(draft.value);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const rule: BrowseRowRule = type === "genres" ? { type, genres: value.split(",").map((item) => item.trim()).filter(Boolean) } : type === "collection" ? { type, collectionId: value } : { type };
    void onSave({ title, rule });
  };
  return <div className="presentation-editor-backdrop"><form className="presentation-editor browse-row-editor" onSubmit={submit}><header><div><p className="stream-kicker">{draft.id ? "Edit Browse Row" : "New Browse Row"}</p><h2>{draft.id ? draft.title : "Add a shelf"}</h2></div><button type="button" aria-label="Close Browse Row editor" onClick={onCancel}>×</button></header><div className="presentation-fields"><label><span>Row title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={64} required autoFocus /></label><label><span>Content source</span><select value={type} onChange={(event) => { setType(event.target.value as BrowseRowRule["type"]); setValue(""); }}><option value="all">All games</option><option value="continue">Continue Playing</option><option value="favorites">Favorites</option><option value="recent">Recently Played</option><option value="genres">Matching genres</option><option value="collection">A Collection</option></select></label>{type === "genres" && <label><span>Genres, separated by commas</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Adventure, RPG, Strategy" required /></label>}{type === "collection" && <label><span>Collection</span><select value={value} onChange={(event) => setValue(event.target.value)} required><option value="">Choose a Collection…</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>}</div><p className="row-editor-note">Empty personal rows—such as Favorites before a player adds any—stay hidden on Browse until they have content.</p><footer><button className="stream-button secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button><button className="stream-button primary" type="submit" disabled={saving}>{saving ? "Saving…" : draft.id ? "Save Browse Row" : "Create Browse Row"}</button></footer></form></div>;
}

function CollectionMiniCovers({ gameIds, games }: { gameIds: string[]; games: GameSummary[] }): React.JSX.Element {
  const selected = gameIds.map((id) => games.find((game) => game.id === id)).filter((game): game is GameSummary => Boolean(game)).slice(0, 3);
  return <div className="collection-mini-covers">{selected.map((game) => <span key={game.id}><CoverArt game={game} /></span>)}</div>;
}

function rowRuleValue(rule: BrowseRowRule): string {
  if (rule.type === "genres") return rule.genres.join(", ");
  if (rule.type === "collection") return rule.collectionId;
  return "";
}

function describeRule(rule: BrowseRowRule, administration: PresentationAdministration): string {
  if (rule.type === "all") return "All games in the library";
  if (rule.type === "continue") return "Games with saved progress for the active player";
  if (rule.type === "favorites") return "Favorites for the active player";
  if (rule.type === "recent") return "Recently played by the active player";
  if (rule.type === "genres") return `Genres · ${rule.genres.join(", ")}`;
  const collection = administration.collectionOptions.find((item) => item.id === rule.collectionId);
  return `Collection · ${collection?.name ?? "Unavailable"}`;
}
