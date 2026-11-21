import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredGameFile } from "../../domain/types.js";
import { Atari2600MetadataProvider, RetronianMetadataProvider } from "../metadata-provider.js";
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
    const file: DiscoveredGameFile = { relativePath: "Castlevania (USA).nes", displayName: "Castlevania", platform: "nes", contentHash: "abc123", byteSize: 1, modifiedAtMs: 1 };
    const match = {
      providerKey: "retronian" as const, platform: "nes" as const, contentHash: "abc123", canonicalId: "castlevania", displayName: "Castlevania", releaseYear: 1986,
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
      platform: "nes",
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
      platform: "nes",
      contentHash: "different-local-dump",
      byteSize: 1,
      modifiedAtMs: 1,
    };

    await expect(provider.match([file])).resolves.toEqual([
      expect.objectContaining({ canonicalId: "castlevania", contentHash: "different-local-dump" }),
    ]);
  });

  it("downloads and applies SNES metadata instead of leaving placeholder details", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "portal-snes-metadata-"));
    temporaryDirectories.push(cacheRoot);
    const fetcher = vi.fn(async () => new Response(JSON.stringify([fixtureSnesMetadata()]))) as typeof fetch;
    const provider = new RetronianMetadataProvider(cacheRoot, fetcher);

    await expect(provider.match([{
      relativePath: "SNES/Super Mario World (USA).sfc",
      displayName: "Super Mario World",
      platform: "snes",
      contentHash: "snes123",
      byteSize: 1,
      modifiedAtMs: 1,
    }])).resolves.toEqual([
      expect.objectContaining({
        contentHash: "snes123",
        canonicalId: "super-mario-world",
        description: "Mario and Luigi travel through Dinosaur Land to rescue Princess Toadstool.",
        genres: expect.arrayContaining(["Platformer"]),
      }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/v1/sfc.json"), expect.objectContaining({ method: "GET" }));
  });

  it("stores an SNES match and presents its enriched details", () => {
    const database = openMemoryDatabase(path.resolve(process.cwd(), "migrations"));
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    const file: DiscoveredGameFile = {
      relativePath: "SNES/Super Mario World (USA).sfc",
      displayName: "Super Mario World",
      platform: "snes",
      contentHash: "snes123",
      byteSize: 1,
      modifiedAtMs: 1,
    };
    const match = {
      providerKey: "retronian" as const, platform: "snes" as const,
      contentHash: "snes123",
      canonicalId: "super-mario-world",
      displayName: "Super Mario World",
      releaseYear: 1990,
      description: "Mario and Luigi travel through Dinosaur Land to rescue Princess Toadstool.",
      genres: ["Platformer"],
      series: "Super Mario World",
      coverUrl: "https://example.test/Super%20Mario%20World.png",
    };

    catalog.commitScan([file], new Date("2026-09-07T12:00:00.000Z"), [match]);

    expect(catalog.listGames()[0]).toMatchObject({
      platform: "snes",
      releaseYear: 1990,
      description: "Mario and Luigi travel through Dinosaur Land to rescue Princess Toadstool.",
      genres: ["Platformer"],
      metadataStatus: "matched",
    });
    database.close();
  });

  it("leaves Atari 2600 files on filename metadata without requesting another platform catalog", async () => {
    const fetcher = vi.fn(async () => new Response("[]")) as typeof fetch;
    const provider = new RetronianMetadataProvider(path.join(os.tmpdir(), "unused-atari-metadata"), fetcher);

    await expect(provider.match([{
      relativePath: "Atari 2600/Adventure.a26",
      displayName: "Adventure",
      platform: "atari2600",
      contentHash: "atari123",
      byteSize: 4_096,
      modifiedAtMs: 1,
    }])).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("matches Atari 2600 ROMs by SHA-1 and combines canonical names, years, genres, and artwork", async () => {
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "portal-atari-metadata-"));
    temporaryDirectories.push(cacheRoot);
    const openVgdbArchive = await openVgdbFixtureArchive(cacheRoot);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/no-intro/")) return new Response(atariIdentityFixture());
      if (url.includes("/releaseyear/")) return new Response(atariYearFixture());
      if (url.includes("/genre/")) return new Response(atariGenreFixture());
      if (url.includes("openvgdb.zip")) return new Response(openVgdbArchive);
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;
    const provider = new Atari2600MetadataProvider(cacheRoot, fetcher);
    const file: DiscoveredGameFile = {
      relativePath: "Atari 2600/Pitfall.a26",
      displayName: "Pitfall",
      platform: "atari2600",
      contentHash: "local-sha256",
      contentSha1: "8d525480445d48cc48460dc666ebad78c8fb7b73",
      byteSize: 4_096,
      modifiedAtMs: 1,
    };

    await expect(provider.match([file])).resolves.toEqual([expect.objectContaining({
      providerKey: "libretro",
      platform: "atari2600",
      contentHash: "local-sha256",
      canonicalId: "42ad47bf",
      displayName: "Pitfall!: Pitfall Harry's Jungle Adventure",
      releaseYear: 1982,
      description: "Guide Pitfall Harry through a dangerous jungle in search of treasure.",
      genres: ["Action", "Platformer"],
      coverUrl: expect.stringContaining("Pitfall!%20-%20Pitfall%20Harry's%20Jungle%20Adventure%20(USA).png"),
    })]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const call of fetcher.mock.calls) {
      expect(call[1]).toMatchObject({ method: "GET" });
      expect(call[1]).not.toHaveProperty("body");
    }
    expect(await readFile(path.join(cacheRoot, "libretro-atari2600-no-intro.dat"), "utf8")).toContain("Pitfall");
    expect((await readFile(path.join(cacheRoot, "openvgdb-v29.sqlite"))).subarray(0, 16).toString()).toBe("SQLite format 3\0");
  });

  it("applies an Atari 2600 provider match to the catalog", () => {
    const database = openMemoryDatabase(path.resolve(process.cwd(), "migrations"));
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    const file: DiscoveredGameFile = { relativePath: "Atari 2600/Pitfall.a26", displayName: "Pitfall", platform: "atari2600", contentHash: "atari-hash", byteSize: 1, modifiedAtMs: 1 };

    catalog.commitScan([file], new Date("2026-09-12T12:00:00.000Z"), [{
      providerKey: "libretro", platform: "atari2600", contentHash: "atari-hash", canonicalId: "42ad47bf",
      displayName: "Pitfall!", releaseYear: 1982, description: "A matched Atari description.",
      genres: ["Platformer"], series: "Pitfall", coverUrl: "https://example.test/pitfall.png",
    }]);

    expect(catalog.listGames()[0]).toMatchObject({
      displayName: "Pitfall!",
      releaseYear: 1982,
      description: "A matched Atari description.",
      genres: ["Platformer"],
      metadataStatus: "matched",
    });
    database.close();
  });

  it("keeps metadata matches platform-scoped when files have identical bytes", () => {
    const database = openMemoryDatabase(path.resolve(process.cwd(), "migrations"));
    const catalog = new CatalogRepository(database);
    catalog.ensureLibrarySource("/roms");
    catalog.commitScan([
      { relativePath: "NES/Shared Bytes.nes", displayName: "Shared Bytes", platform: "nes", contentHash: "same-hash", byteSize: 1, modifiedAtMs: 1 },
      { relativePath: "Atari 2600/Shared Bytes.a26", displayName: "Shared Bytes", platform: "atari2600", contentHash: "same-hash", byteSize: 1, modifiedAtMs: 1 },
    ], new Date("2026-09-12T12:00:00.000Z"), [{
      providerKey: "retronian", platform: "nes", contentHash: "same-hash", canonicalId: "nes-shared",
      displayName: "NES Match", releaseYear: 1988, description: "NES metadata.", genres: ["Action"], series: null, coverUrl: null,
    }, {
      providerKey: "libretro", platform: "atari2600", contentHash: "same-hash", canonicalId: "atari-shared",
      displayName: "Atari Match", releaseYear: 1982, description: "Atari metadata.", genres: ["Shooter"], series: null, coverUrl: null,
    }]);

    expect(catalog.listGames().map(({ platform, displayName }) => ({ platform, displayName }))).toEqual(expect.arrayContaining([
      { platform: "nes", displayName: "NES Match" },
      { platform: "atari2600", displayName: "Atari Match" },
    ]));
    database.close();
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

function fixtureSnesMetadata() {
  return {
    id: "super-mario-world",
    platform: "sfc",
    titles: [{ text: "Super Mario World", lang: "en", region: "us" }],
    first_release_date: "1990-11-21",
    descriptions: [{ text: "Mario and Luigi travel through Dinosaur Land to rescue Princess Toadstool.", lang: "en", source: "wikipedia_en" }],
    genres: ["platformer"],
    roms: [{ name: "Super Mario World (USA)", region: "us", sha256: "snes123" }],
    media: [{ kind: "boxart", region: "us", url: "https://example.test/Super%20Mario%20World%20%28USA%29.png" }],
  };
}

function atariIdentityFixture(): string {
  return `clrmamepro (\n  name "Atari - 2600"\n)\ngame (\n  name "Pitfall! - Pitfall Harry's Jungle Adventure (USA)"\n  region "USA"\n  rom ( name "Pitfall! - Pitfall Harry's Jungle Adventure (USA).a26" size 4096 crc 42AD47BF md5 3E90CF23106F2E08B2781E41299DE556 sha1 8D525480445D48CC48460DC666EBAD78C8FB7B73 )\n)\n`;
}

function atariYearFixture(): string {
  return `clrmamepro (\n  name "Atari - 2600"\n)\ngame (\n  comment "Pitfall! - Pitfall Harry's Jungle Adventure (USA)"\n  releaseyear "1982"\n  rom ( crc 42AD47BF )\n)\n`;
}

function atariGenreFixture(): string {
  return `clrmamepro (\n  name "Atari - 2600"\n)\ngame (\n  comment "Pitfall! - Pitfall Harry's Jungle Adventure (USA)"\n  genre "Platform"\n  rom ( crc 42AD47BF )\n)\n`;
}

async function openVgdbFixtureArchive(root: string): Promise<Buffer> {
  const databasePath = path.join(root, "openvgdb-fixture.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE SYSTEMS(systemID INTEGER, systemName TEXT);
    CREATE TABLE ROMs(romID INTEGER, systemID INTEGER, romHashSHA1 TEXT, romHashCRC TEXT);
    CREATE TABLE RELEASES(romID INTEGER, releaseTitleName TEXT, releaseDate TEXT, releaseDescription TEXT, releaseGenre TEXT);
    INSERT INTO SYSTEMS VALUES (3, 'Atari 2600');
    INSERT INTO ROMs VALUES (1, 3, '8D525480445D48CC48460DC666EBAD78C8FB7B73', '42AD47BF');
    INSERT INTO RELEASES VALUES (1, 'Pitfall!: Pitfall Harry''s Jungle Adventure', 'Apr 20, 1982', 'Guide Pitfall Harry through a dangerous jungle in search of treasure.', 'Action,Platformer,2D');
  `);
  database.close();
  return storedZip("openvgdb.sqlite", await readFile(databasePath));
}

function storedZip(filename: string, contents: Buffer): Buffer {
  const name = Buffer.from(filename);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(contents.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(contents.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + contents.length, 16);
  return Buffer.concat([local, name, contents, central, name, end]);
}
