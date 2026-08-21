import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscoveredGameFile } from "../../domain/types.js";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";
import { PortalPresentation } from "../portal-presentation.js";

const migrationsDir = path.resolve(process.cwd(), "migrations");

describe("Portal Presentation module interface", () => {
  it("persists editable Collections and resolves a Collection-backed Browse Row", () => {
    const database = openMemoryDatabase(migrationsDir);
    const catalog = seededCatalog(database);
    const presentation = new PortalPresentation(database);
    const games = catalog.listGames();
    const collection = presentation.createCollection({
      name: "Robot Masters",
      description: "A custom route through the Mega Man games.",
      gameIds: games.map((game) => game.id),
    }, games, new Date("2026-08-18T10:00:00.000Z"));

    const row = presentation.createBrowseRow(
      { title: "Robot Masters", rule: { type: "collection", collectionId: collection.id } },
      new Set(presentation.administration(games).collectionOptions.map((item) => item.id)),
      new Date("2026-08-18T10:01:00.000Z"),
    );
    expect(presentation.catalog(games).browseRows.find((item) => item.id === row.id)?.games).toHaveLength(2);

    const updated = presentation.updateCollection(collection.id, {
      name: "Blue Bomber",
      description: "One selected entry.",
      gameIds: [games[0].id],
    }, games);
    expect(updated).toMatchObject({ name: "Blue Bomber", gameIds: [games[0].id] });
    expect(presentation.catalog(games).browseRows.find((item) => item.id === row.id)?.games).toHaveLength(1);

    presentation.deleteCollection(collection.id);
    expect(presentation.administration(games).collections.some((item) => item.id === collection.id)).toBe(false);
    expect(presentation.administration(games).collections.map((item) => item.name)).toContain("Mega Man");
    expect(presentation.administration(games).browseRows.some((item) => item.id === row.id)).toBe(false);
    database.close();
  });

  it("materializes existing derived groups once so they can be edited or permanently removed", () => {
    const database = openMemoryDatabase(migrationsDir);
    const catalog = seededCatalog(database);
    const presentation = new PortalPresentation(database);
    const games = catalog.listGames();
    const initial = presentation.administration(games).collections.find((collection) => collection.name === "Mega Man");
    expect(initial).toBeDefined();

    const edited = presentation.updateCollection(initial!.id, {
      name: "Robot Masters",
      description: "An administrator-owned Collection.",
      gameIds: [games[0].id],
    }, games);
    expect(edited).toMatchObject({ name: "Robot Masters", gameIds: [games[0].id] });
    expect(presentation.catalog(games).collections.find((collection) => collection.id === initial!.id)?.games).toHaveLength(1);

    presentation.deleteCollection(initial!.id);
    expect(presentation.catalog(games).collections.some((collection) => collection.id === initial!.id)).toBe(false);
    database.close();
  });

  it("seeds general Browse Rows without title-specific Series rows and supports ordering", () => {
    const database = openMemoryDatabase(migrationsDir);
    const catalog = seededCatalog(database);
    const presentation = new PortalPresentation(database);
    const games = catalog.listGames();
    const initial = presentation.administration(games).browseRows;

    expect(initial.map((row) => row.title)).toEqual([
      "Continue Playing",
      "Favorites",
      "Recently Played",
      "Nintendo Entertainment System",
      "Action & Platforming",
      "Adventures & Strategy",
      "Sports & Competition",
    ]);
    expect(initial.some((row) => row.title === "Mega Man")).toBe(false);

    const reversed = presentation.orderBrowseRows(initial.map((row) => row.id).reverse());
    expect(reversed[0].id).toBe(initial.at(-1)?.id);
    expect(() => presentation.orderBrowseRows([initial[0].id])).toThrow("every current row exactly once");
    database.close();
  });
});

function seededCatalog(database: ReturnType<typeof openMemoryDatabase>): CatalogRepository {
  const catalog = new CatalogRepository(database);
  catalog.ensureLibrarySource("/roms");
  const files: DiscoveredGameFile[] = [
    { relativePath: "Mega Man.nes", displayName: "Mega Man", contentHash: "hash-one", byteSize: 1, modifiedAtMs: 1 },
    { relativePath: "Mega Man 3.nes", displayName: "Mega Man 3", contentHash: "hash-two", byteSize: 1, modifiedAtMs: 1 },
  ];
  catalog.commitScan(files, new Date("2026-08-18T09:00:00.000Z"));
  return catalog;
}
