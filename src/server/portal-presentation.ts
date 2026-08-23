import { randomUUID } from "node:crypto";
import { deriveInitialCollections, slugify } from "../domain/catalog-presentation.js";
import type {
  BrowseRowDefinition,
  BrowseRowInput,
  BrowseRowRule,
  CatalogCollection,
  CatalogPresentation,
  CollectionInput,
  CollectionDefinition,
  GameSummary,
  PresentationAdministration,
} from "../domain/types.js";
import type { PortalDatabase } from "./database.js";

interface CollectionRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface CollectionGameRow { collection_id: string; game_id: string }
interface BrowseRowRecord { id: string; title: string; source_type: BrowseRowRule["type"]; source_value: string | null; position: number }

export class PortalPresentation {
  constructor(private readonly database: PortalDatabase) {}

  catalog(games: GameSummary[]): CatalogPresentation {
    this.ensureCollectionsMaterialized(games);
    const collections = this.collectionsForCatalog(games);
    return {
      collections,
      browseRows: this.listBrowseRows().map((row) => ({ ...row, games: resolveGames(row.rule, games, collections) })),
    };
  }

  administration(games: GameSummary[]): PresentationAdministration {
    const presentation = this.catalog(games);
    return {
      collections: this.listCollectionDefinitions(),
      browseRows: this.listBrowseRows(),
      collectionOptions: presentation.collections.map(({ id, name }) => ({ id, name })),
    };
  }

  createCollection(input: CollectionInput, games: GameSummary[], now = new Date()): CollectionDefinition {
    this.ensureCollectionsMaterialized(games);
    const normalized = validateCollection(input, games);
    const id = `collection-${randomUUID()}`;
    const slug = this.availableSlug(normalized.name);
    const timestamp = now.toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO collections(id, slug, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, slug, normalized.name, normalized.description, timestamp, timestamp);
      this.replaceCollectionGames(id, normalized.gameIds);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getCollection(id)!;
  }

  updateCollection(id: string, input: CollectionInput, games: GameSummary[], now = new Date()): CollectionDefinition {
    this.ensureCollectionsMaterialized(games);
    if (!this.getCollection(id)) throw new Error("Collection not found.");
    const normalized = validateCollection(input, games);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?")
        .run(normalized.name, normalized.description, now.toISOString(), id);
      this.replaceCollectionGames(id, normalized.gameIds);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getCollection(id)!;
  }

  deleteCollection(id: string): void {
    if (!this.getCollection(id)) throw new Error("Collection not found.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM browse_rows WHERE source_type = 'collection' AND source_value = ?").run(id);
      this.database.prepare("DELETE FROM collections WHERE id = ?").run(id);
      this.normalizeBrowseRowPositions();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createBrowseRow(input: BrowseRowInput, collectionIds: Set<string>, now = new Date()): BrowseRowDefinition {
    const normalized = validateBrowseRow(input, collectionIds);
    const id = `row-${randomUUID()}`;
    const position = (this.database.prepare("SELECT COALESCE(MAX(position), 0) + 10 AS position FROM browse_rows").get() as unknown as { position: number }).position;
    this.database.prepare("INSERT INTO browse_rows(id, title, source_type, source_value, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, normalized.title, normalized.rule.type, encodeRuleValue(normalized.rule), position, now.toISOString(), now.toISOString());
    return this.getBrowseRow(id)!;
  }

  updateBrowseRow(id: string, input: BrowseRowInput, collectionIds: Set<string>, now = new Date()): BrowseRowDefinition {
    if (!this.getBrowseRow(id)) throw new Error("Browse Row not found.");
    const normalized = validateBrowseRow(input, collectionIds);
    this.database.prepare("UPDATE browse_rows SET title = ?, source_type = ?, source_value = ?, updated_at = ? WHERE id = ?")
      .run(normalized.title, normalized.rule.type, encodeRuleValue(normalized.rule), now.toISOString(), id);
    return this.getBrowseRow(id)!;
  }

  deleteBrowseRow(id: string): void {
    const result = this.database.prepare("DELETE FROM browse_rows WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error("Browse Row not found.");
    this.normalizeBrowseRowPositions();
  }

  orderBrowseRows(ids: string[]): BrowseRowDefinition[] {
    const current = this.listBrowseRows().map((row) => row.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || current.some((id) => !ids.includes(id))) {
      throw new Error("Browse Row order must contain every current row exactly once.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const temporary = this.database.prepare("UPDATE browse_rows SET position = ? WHERE id = ?");
      ids.forEach((id, index) => temporary.run(-1000 - index, id));
      ids.forEach((id, index) => temporary.run((index + 1) * 10, id));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.listBrowseRows();
  }

  private listCollectionDefinitions(): CollectionDefinition[] {
    const collections = this.database.prepare("SELECT id, slug, name, description, created_at, updated_at FROM collections ORDER BY name COLLATE NOCASE").all() as unknown as CollectionRow[];
    const games = this.database.prepare("SELECT collection_id, game_id FROM collection_games ORDER BY collection_id, position").all() as unknown as CollectionGameRow[];
    return collections.map((collection) => ({
      id: collection.id,
      slug: collection.slug,
      name: collection.name,
      description: collection.description,
      gameIds: games.filter((game) => game.collection_id === collection.id).map((game) => game.game_id),
      createdAt: collection.created_at,
      updatedAt: collection.updated_at,
    }));
  }

  private getCollection(id: string): CollectionDefinition | null {
    return this.listCollectionDefinitions().find((collection) => collection.id === id) ?? null;
  }

  private collectionsForCatalog(games: GameSummary[]): CatalogCollection[] {
    const byId = new Map(games.map((game) => [game.id, game]));
    return this.listCollectionDefinitions().map((collection) => ({
      id: collection.id,
      slug: collection.slug,
      name: collection.name,
      description: collection.description,
      games: collection.gameIds.map((id) => byId.get(id)).filter((game): game is GameSummary => Boolean(game)),
    })).sort((left, right) => left.name.localeCompare(right.name, "en-US", { numeric: true }));
  }

  private listBrowseRows(): BrowseRowDefinition[] {
    const rows = this.database.prepare("SELECT id, title, source_type, source_value, position FROM browse_rows ORDER BY position, title COLLATE NOCASE").all() as unknown as BrowseRowRecord[];
    return rows.map(toBrowseRowDefinition);
  }

  private getBrowseRow(id: string): BrowseRowDefinition | null {
    const row = this.database.prepare("SELECT id, title, source_type, source_value, position FROM browse_rows WHERE id = ?").get(id) as unknown as BrowseRowRecord | undefined;
    return row ? toBrowseRowDefinition(row) : null;
  }

  private replaceCollectionGames(collectionId: string, gameIds: string[]): void {
    this.database.prepare("DELETE FROM collection_games WHERE collection_id = ?").run(collectionId);
    const insert = this.database.prepare("INSERT INTO collection_games(collection_id, game_id, position) VALUES (?, ?, ?)");
    gameIds.forEach((gameId, index) => insert.run(collectionId, gameId, index));
  }

  private availableSlug(name: string): string {
    const base = slugify(name) || "collection";
    let slug = base;
    let suffix = 2;
    const exists = this.database.prepare("SELECT 1 FROM collections WHERE slug = ?");
    while (exists.get(slug)) slug = `${base}-${suffix++}`;
    return slug;
  }

  private normalizeBrowseRowPositions(): void {
    const rows = this.database.prepare("SELECT id FROM browse_rows ORDER BY position, title COLLATE NOCASE").all() as unknown as Array<{ id: string }>;
    const update = this.database.prepare("UPDATE browse_rows SET position = ? WHERE id = ?");
    rows.forEach((row, index) => update.run(-1000 - index, row.id));
    rows.forEach((row, index) => update.run((index + 1) * 10, row.id));
  }

  private ensureCollectionsMaterialized(games: GameSummary[], now = new Date()): void {
    const state = this.database.prepare("SELECT collections_materialized FROM presentation_state WHERE id = 1").get() as unknown as { collections_materialized: number };
    if (state.collections_materialized === 1 || games.length === 0) return;
    const seeds = deriveInitialCollections(games);
    const existing = this.database.prepare("SELECT id FROM collections WHERE id = ? OR slug = ? LIMIT 1");
    const insertCollection = this.database.prepare("INSERT INTO collections(id, slug, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    const insertGame = this.database.prepare("INSERT INTO collection_games(collection_id, game_id, position) VALUES (?, ?, ?)");
    const timestamp = now.toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const seed of seeds) {
        if (existing.get(seed.id, seed.slug)) continue;
        insertCollection.run(seed.id, seed.slug, seed.name, seed.description, timestamp, timestamp);
        seed.games.forEach((game, index) => insertGame.run(seed.id, game.id, index));
      }
      this.database.prepare("UPDATE presentation_state SET collections_materialized = 1 WHERE id = 1").run();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function resolveGames(rule: BrowseRowRule, games: GameSummary[], collections: CatalogCollection[]): GameSummary[] {
  switch (rule.type) {
    case "all": return games;
    case "continue": return games.filter((game) => game.isContinuePlaying);
    case "favorites": return games.filter((game) => game.isFavorite);
    case "recent": return games.filter((game) => game.lastPlayedAt).sort((left, right) => right.lastPlayedAt!.localeCompare(left.lastPlayedAt!));
    case "genres": return games.filter((game) => game.genres.some((genre) => rule.genres.includes(genre)));
    case "collection": return collections.find((collection) => collection.id === rule.collectionId)?.games ?? [];
  }
}

function toBrowseRowDefinition(row: BrowseRowRecord): BrowseRowDefinition {
  const type = row.source_type;
  const rule: BrowseRowRule = type === "genres"
    ? { type, genres: (row.source_value ?? "").split("|").map((genre) => genre.trim()).filter(Boolean) }
    : type === "collection"
      ? { type, collectionId: row.source_value ?? "" }
      : { type };
  return { id: row.id, title: row.title, position: row.position, rule };
}

function encodeRuleValue(rule: BrowseRowRule): string | null {
  if (rule.type === "genres") return rule.genres.join("|");
  if (rule.type === "collection") return rule.collectionId;
  return null;
}

function validateCollection(input: CollectionInput, games: GameSummary[]): CollectionInput {
  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  const gameIds = [...new Set(Array.isArray(input.gameIds) ? input.gameIds.map(String) : [])];
  const available = new Set(games.map((game) => game.id));
  if (!name || name.length > 64) throw new Error("Collection name must be between 1 and 64 characters.");
  if (!description || description.length > 240) throw new Error("Collection description must be between 1 and 240 characters.");
  if (gameIds.length === 0) throw new Error("Add at least one game to the Collection.");
  if (gameIds.some((id) => !available.has(id))) throw new Error("A selected game is no longer in the library.");
  return { name, description, gameIds };
}

function validateBrowseRow(input: BrowseRowInput, collectionIds: Set<string>): BrowseRowInput {
  const title = String(input.title ?? "").trim();
  const rule = input.rule;
  if (!title || title.length > 64) throw new Error("Browse Row title must be between 1 and 64 characters.");
  if (!rule || !["all", "continue", "favorites", "recent", "genres", "collection"].includes(rule.type)) throw new Error("Choose a valid Browse Row source.");
  if (rule.type === "genres") {
    const genres = [...new Set((Array.isArray(rule.genres) ? rule.genres : []).map((genre) => String(genre).trim()).filter(Boolean))].slice(0, 12);
    if (genres.length === 0) throw new Error("Add at least one genre to this Browse Row.");
    return { title, rule: { type: "genres", genres } };
  }
  if (rule.type === "collection") {
    const collectionId = String(rule.collectionId ?? "");
    if (!collectionIds.has(collectionId)) throw new Error("Choose an available Collection for this Browse Row.");
    return { title, rule: { type: "collection", collectionId } };
  }
  return { title, rule: { type: rule.type } };
}
