import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredGameFile } from "../../domain/types.js";
import { RetronianMetadataProvider } from "../metadata-provider.js";
import { CatalogRepository } from "../catalog-repository.js";
import { openMemoryDatabase } from "../database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("automatic Metadata Match enrichment", () => {
  it("keeps the original curated catalog ahead of an automatic provider match", () => {
    const database = openMemoryDatabase(path.resolve(process.cwd(), "migrations"));
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    const file: DiscoveredGameFile = { relativePath: "Castlevania (USA).nes", displayName: "Castlevania", contentHash: "abc123", byteSize: 1, modifiedAtMs: 1 };
    const match = {
      contentHash: "abc123", canonicalId: "castlevania", displayName: "Castlevania", releaseYear: 1986,
      description: "A matched description.", genres: ["Action", "Adventure"], series: "Castlevania",
      coverUrl: "https://example.test/castlevania.png",
    };

    catalog.commitScan([file], new Date("2026-08-21T12:00:00.000Z"), [match]);

    expect(catalog.listGames()[0]).toMatchObject({
      displayName: "Castlevania",
      releaseYear: 1987,
      description: "Enter Dracula's castle as Simon Belmont and fight through a landmark gothic action platformer.",
      genres: ["Action", "Platformer"],
      metadataStatus: "curated",
    });
    database.close();
  });

  it("downloads the public catalog without sending library data and matches SHA-256 locally", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "portal-metadata-"));
    temporaryDirectories.push(cacheRoot);
    const fetcher = vi.fn(async () => new Response(JSON.stringify([fixtureMetadata()]))) as typeof fetch;
    const provider = new RetronianMetadataProvider(cacheRoot, fetcher);
    const file: DiscoveredGameFile = {
      relativePath: "Castlevania (USA).nes",
      displayName: "Castlevania",
      contentHash: "abc123",
      byteSize: 1,
      modifiedAtMs: 1,
    };

    const matches = await provider.match([file]);

    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/v1/fc.json"), expect.objectContaining({ method: "GET" }));
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
    expect(matches).toEqual([expect.objectContaining({
      contentHash: "abc123",
      canonicalId: "castlevania",
      displayName: "Castlevania",
      releaseYear: 1986,
      genres: expect.arrayContaining(["Action", "Adventure"]),
      coverUrl: expect.stringContaining("Castlevania%20%28USA%29.png"),
    })]);
    expect(JSON.parse(await readFile(path.join(cacheRoot, "retronian-fc.json"), "utf8"))).toHaveLength(1);
  });

  it("reuses the persistent cache on later scans", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "portal-metadata-cache-"));
    temporaryDirectories.push(cacheRoot);
    const firstFetch = vi.fn(async () => new Response(JSON.stringify([fixtureMetadata()]))) as typeof fetch;
    await new RetronianMetadataProvider(cacheRoot, firstFetch).match([]);
    const offlineFetch = vi.fn(async () => { throw new Error("offline"); }) as typeof fetch;

    await expect(new RetronianMetadataProvider(cacheRoot, offlineFetch).match([])).resolves.toEqual([]);
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it("uses an unambiguous normalized ROM title when a local dump has a different hash", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "portal-metadata-name-"));
    temporaryDirectories.push(cacheRoot);
    const fetcher = vi.fn(async () => new Response(JSON.stringify([fixtureMetadata()]))) as typeof fetch;
    const provider = new RetronianMetadataProvider(cacheRoot, fetcher);
    const file: DiscoveredGameFile = {
      relativePath: "Castlevania (USA) [Rev A].nes",
      displayName: "Castlevania",
      contentHash: "different-local-dump",
      byteSize: 1,
      modifiedAtMs: 1,
    };

    await expect(provider.match([file])).resolves.toEqual([
      expect.objectContaining({ canonicalId: "castlevania", contentHash: "different-local-dump" }),
    ]);
  });
});

function fixtureMetadata() {
  return {
    id: "castlevania",
    platform: "fc",
    titles: [{ text: "Castlevania", lang: "en", region: "us" }],
    first_release_date: "1986-09-26",
    descriptions: [{ text: "Castlevania is an action-adventure platform game released for the Nintendo Entertainment System.", lang: "en", source: "wikipedia_en" }],
    roms: [{ name: "Castlevania (USA)", region: "us", sha256: "abc123" }],
    media: [{ kind: "boxart", region: "us", url: "https://example.test/Castlevania%20%28USA%29.png" }],
  };
}
