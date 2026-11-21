import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";
import { platforms } from "../domain/platforms.js";
import type { DiscoveredGameFile, PlatformKey, WebPlayablePlatformKey } from "../domain/types.js";
import { normalizeGameFilename } from "./filename-normalizer.js";

type MetadataPlatformKey = Exclude<WebPlayablePlatformKey, "atari2600">;

const CATALOGS: Record<MetadataPlatformKey, { url: string; cacheName: string }> = {
  nes: { url: "https://gamedb.retronian.com/api/v1/fc.json", cacheName: "retronian-fc.json" },
  snes: { url: "https://gamedb.retronian.com/api/v1/sfc.json", cacheName: "retronian-sfc.json" },
};
const LIBRETRO_ROOT = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat";
const ATARI_CATALOGS = {
  identity: `${LIBRETRO_ROOT}/no-intro/Atari%20-%202600.dat`,
  releaseYear: `${LIBRETRO_ROOT}/releaseyear/Atari%20-%202600.dat`,
  genre: `${LIBRETRO_ROOT}/genre/Atari%20-%202600.dat`,
} as const;
const OPENVGDB_URL = "https://github.com/OpenVGDB/OpenVGDB/releases/download/v29.0/openvgdb.zip";
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

const MAX_OPENVGDB_BYTES = 64 * 1024 * 1024;

export interface MetadataMatch {
  providerKey: "retronian" | "libretro";
  platform: PlatformKey;
  contentHash: string;
  canonicalId: string;
  displayName: string;
  releaseYear: number;
  description: string;
  genres: string[];
  series: string | null;
  coverUrl: string | null;
}

interface RetronianEntry {
  id: string;
  first_release_date?: string;
  titles?: Array<{ text: string; lang: string; region?: string }>;
  descriptions?: Array<{ text: string; lang: string; source?: string }>;
  genres?: string[];
  roms?: Array<{ name: string; region?: string; sha256?: string }>;
  media?: Array<{ kind: string; region?: string; url: string }>;
}

interface AtariDatEntry {
  name: string | null;
  comment: string | null;
  region: string | null;
  releaseYear: number | null;
  genre: string | null;
  crc: string | null;
  sha1: string | null;
  romName: string | null;
}

interface OpenVgdbAtariEntry {
  sha1: string;
  crc: string;
  title: string | null;
  releaseDate: string | null;
  description: string | null;
  genre: string | null;
}

export interface MetadataProvider {
  match(files: DiscoveredGameFile[]): Promise<MetadataMatch[]>;
}

export class PortalMetadataProvider implements MetadataProvider {
  private readonly providers: MetadataProvider[];

  constructor(cacheRoot: string, fetcher: typeof fetch = fetch) {
    this.providers = [
      new RetronianMetadataProvider(cacheRoot, fetcher),
      new Atari2600MetadataProvider(cacheRoot, fetcher),
    ];
  }

  async match(files: DiscoveredGameFile[]): Promise<MetadataMatch[]> {
    const results = await Promise.allSettled(this.providers.map((provider) => provider.match(files)));
    const matches: MetadataMatch[] = [];
    let firstError: unknown = null;
    for (const result of results) {
      if (result.status === "fulfilled") matches.push(...result.value);
      else firstError ??= result.reason;
    }
    if (!matches.length && firstError) throw firstError;
    return matches;
  }
}

export class RetronianMetadataProvider {
  constructor(
    private readonly cacheRoot: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async match(files: DiscoveredGameFile[]): Promise<MetadataMatch[]> {
    const requestedPlatforms = (["nes", "snes"] as const).filter((platform) =>
      files.some((file) => file.platform === platform),
    );
    const matches = await Promise.all(requestedPlatforms.map((platform) =>
      this.matchPlatform(files.filter((file) => file.platform === platform), platform),
    ));
    return matches.flat();
  }

  private async matchPlatform(files: DiscoveredGameFile[], platform: MetadataPlatformKey): Promise<MetadataMatch[]> {
    const entries = await this.loadCatalog(platform);
    const byHash = new Map<string, { entry: RetronianEntry; region?: string }>();
    const byTitle = new Map<string, { entry: RetronianEntry; region?: string } | null>();
    for (const entry of entries) {
      for (const rom of entry.roms ?? []) {
        if (rom.sha256) byHash.set(rom.sha256.toLocaleLowerCase("en-US"), { entry, region: rom.region });
        addUnambiguousTitle(byTitle, metadataTitleKey(rom.name), { entry, region: rom.region });
      }
      for (const title of entry.titles ?? []) {
        if (title.lang === "en") addUnambiguousTitle(byTitle, metadataTitleKey(title.text), { entry, region: title.region });
      }
    }
    return files.flatMap((file) => {
      const found = byHash.get(file.contentHash.toLocaleLowerCase("en-US"))
        ?? byTitle.get(metadataTitleKey(file.displayName));
      return found ? [toMetadataMatch(file.contentHash, found.entry, found.region, file.displayName, platform)] : [];
    });
  }

  private async loadCatalog(platform: MetadataPlatformKey): Promise<RetronianEntry[]> {
    const catalog = CATALOGS[platform];
    const cachePath = path.join(this.cacheRoot, catalog.cacheName);
    try {
      return parseCatalog(await readFile(cachePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && error instanceof SyntaxError) {
        // Replace an incomplete or corrupt cache with a fresh provider copy.
      } else if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const response = await this.fetcher(catalog.url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Home-Game-Portal/0.1" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("The metadata provider is temporarily unavailable.");
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw new Error("The metadata catalog is unexpectedly large.");
    const entries = parseCatalog(text);
    await mkdir(this.cacheRoot, { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFile(temporary, text, { flag: "w" });
    await rename(temporary, cachePath);
    return entries;
  }
}

export class Atari2600MetadataProvider implements MetadataProvider {
  constructor(
    private readonly cacheRoot: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly openVgdbLoader: (() => Promise<OpenVgdbAtariEntry[]>) | null = null,
  ) {}

  async match(files: DiscoveredGameFile[]): Promise<MetadataMatch[]> {
    const atariFiles = files.filter((file) => file.platform === "atari2600");
    if (!atariFiles.length) return [];
    const [identityText, releaseYearText, genreText, openVgdbEntries] = await Promise.all([
      this.loadCatalog("libretro-atari2600-no-intro.dat", ATARI_CATALOGS.identity),
      this.loadCatalog("libretro-atari2600-releaseyear.dat", ATARI_CATALOGS.releaseYear),
      this.loadCatalog("libretro-atari2600-genre.dat", ATARI_CATALOGS.genre),
      (this.openVgdbLoader ?? (() => this.loadOpenVgdb()))().catch((error: unknown) => {
        console.warn("[Home Game Portal] OpenVGDB Atari supplement unavailable; continuing with Libretro metadata.", error);
        return [];
      }),
    ]);
    const identities = parseAtariDat(identityText).filter((entry) => entry.name && entry.crc);
    const releaseYears = metadataByCrc(parseAtariDat(releaseYearText), "releaseYear");
    const genres = metadataByCrc(parseAtariDat(genreText), "genre");
    const bySha1 = new Map<string, AtariDatEntry>();
    const byTitle = new Map<string, AtariDatEntry | null>();
    const openVgdbBySha1 = new Map(openVgdbEntries.map((entry) => [entry.sha1, entry]));
    const openVgdbByCrc = new Map(openVgdbEntries.map((entry) => [entry.crc, entry]));
    for (const entry of identities) {
      if (entry.sha1) bySha1.set(entry.sha1.toLocaleLowerCase("en-US"), entry);
      if (entry.name) addUnambiguousAtariTitle(byTitle, metadataTitleKey(entry.name), entry);
      if (entry.romName) addUnambiguousAtariTitle(byTitle, metadataTitleKey(entry.romName), entry);
    }
    return atariFiles.flatMap((file) => {
      const found = (file.contentSha1 ? bySha1.get(file.contentSha1.toLocaleLowerCase("en-US")) : undefined)
        ?? byTitle.get(metadataTitleKey(file.displayName));
      if (!found?.name || !found.crc) return [];
      const supplemental = (file.contentSha1 ? openVgdbBySha1.get(file.contentSha1.toLocaleLowerCase("en-US")) : undefined)
        ?? openVgdbByCrc.get(found.crc);
      const releaseYear = yearFrom(supplemental?.releaseDate ?? undefined) ?? found.releaseYear ?? releaseYears.get(found.crc) ?? 1977;
      const displayName = supplemental?.title?.trim() || atariDisplayName(found.name);
      const matchedGenres = genresFromOpenVgdb(supplemental?.genre) ?? [readableAtariGenre(String(found.genre ?? genres.get(found.crc) ?? "Atari 2600"))];
      const description = supplemental?.description?.trim()
        ? conciseDescription(supplemental.description, displayName, "Atari 2600")
        : `${displayName} is a ${matchedGenres[0]} game released for Atari 2600${releaseYear === 1977 ? "" : ` in ${releaseYear}`}.`;
      return [{
        providerKey: "libretro" as const,
        platform: "atari2600" as const,
        contentHash: file.contentHash,
        canonicalId: found.crc.toLocaleLowerCase("en-US"),
        displayName,
        releaseYear,
        description,
        genres: matchedGenres,
        series: inferSeries(displayName),
        coverUrl: libretroAtariCoverUrl(found.name),
      }];
    });
  }

  private async loadCatalog(cacheName: string, url: string): Promise<string> {
    const cachePath = path.join(this.cacheRoot, cacheName);
    try {
      const cached = await readFile(cachePath, "utf8");
      if (!cached.includes("game (")) throw new SyntaxError("The cached Atari metadata catalog is invalid.");
      return cached;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    const response = await this.fetcher(url, {
      method: "GET",
      headers: { Accept: "text/plain", "User-Agent": "Home-Game-Portal/0.1" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("The Atari 2600 metadata provider is temporarily unavailable.");
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw new Error("The Atari 2600 metadata catalog is unexpectedly large.");
    if (!text.includes("game (")) throw new SyntaxError("The Atari 2600 metadata catalog is invalid.");
    await mkdir(this.cacheRoot, { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFile(temporary, text, { flag: "w" });
    await rename(temporary, cachePath);
    return text;
  }

  private async loadOpenVgdb(): Promise<OpenVgdbAtariEntry[]> {
    const databasePath = path.join(this.cacheRoot, "openvgdb-v29.sqlite");
    if (!await hasSqliteHeader(databasePath)) {
      const response = await this.fetcher(OPENVGDB_URL, {
        method: "GET",
        headers: { Accept: "application/zip", "User-Agent": "Home-Game-Portal/0.1" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("The Atari 2600 metadata supplement is temporarily unavailable.");
      const archive = Buffer.from(await response.arrayBuffer());
      if (archive.byteLength > MAX_CATALOG_BYTES) throw new Error("The Atari 2600 metadata supplement archive is unexpectedly large.");
      const database = extractZipEntry(archive, "openvgdb.sqlite");
      if (database.byteLength > MAX_OPENVGDB_BYTES || !database.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))) {
        throw new Error("The Atari 2600 metadata supplement is invalid.");
      }
      await mkdir(this.cacheRoot, { recursive: true });
      const temporary = `${databasePath}.${process.pid}.tmp`;
      await writeFile(temporary, database, { flag: "w" });
      await rename(temporary, databasePath);
    }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const rows = database.prepare(`
        SELECT lower(romHashSHA1) AS sha1, lower(romHashCRC) AS crc,
               releaseTitleName AS title, releaseDate, releaseDescription AS description, releaseGenre AS genre
        FROM ROMs JOIN RELEASES USING (romID) JOIN SYSTEMS USING (systemID)
        WHERE systemName = 'Atari 2600' AND romHashSHA1 IS NOT NULL AND romHashCRC IS NOT NULL
      `).all() as unknown as Array<{ sha1: string; crc: string; title: string | null; releaseDate: string | null; description: string | null; genre: string | null }>;
      return rows;
    } finally {
      database.close();
    }
  }
}

function addUnambiguousTitle(
  index: Map<string, { entry: RetronianEntry; region?: string } | null>,
  key: string,
  value: { entry: RetronianEntry; region?: string },
): void {
  if (!key) return;
  const current = index.get(key);
  if (current === undefined || current?.entry.id === value.entry.id) index.set(key, value);
  else index.set(key, null);
}

function metadataTitleKey(value: string): string {
  return normalizeGameFilename(`${value}.nes`).normalize("NFKD").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}

function addUnambiguousAtariTitle(index: Map<string, AtariDatEntry | null>, key: string, value: AtariDatEntry): void {
  if (!key) return;
  const current = index.get(key);
  if (current === undefined || current?.crc === value.crc) index.set(key, value);
  else index.set(key, null);
}

function parseAtariDat(value: string): AtariDatEntry[] {
  return [...value.matchAll(/^game\s*\(\s*\n([\s\S]*?)^\s*\)\s*$/gm)].map((match) => {
    const block = match[1];
    const rom = block.match(/^\s*rom\s*\(\s*(.*?)\s*\)\s*$/m)?.[1] ?? "";
    return {
      name: quotedDatField(block, "name"),
      comment: quotedDatField(block, "comment"),
      region: quotedDatField(block, "region"),
      releaseYear: datYear(quotedDatField(block, "releaseyear")),
      genre: quotedDatField(block, "genre"),
      crc: tokenDatField(rom, "crc"),
      sha1: tokenDatField(rom, "sha1"),
      romName: quotedDatField(rom, "name"),
    };
  });
}

function quotedDatField(value: string, field: string): string | null {
  const match = value.match(new RegExp(`(?:^|\\s)${field}\\s+"((?:\\\\.|[^"\\\\])*)"`, "m"));
  return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
}

function tokenDatField(value: string, field: string): string | null {
  return value.match(new RegExp(`(?:^|\\s)${field}\\s+([a-z0-9]+)(?:\\s|$)`, "i"))?.[1]?.toLocaleLowerCase("en-US") ?? null;
}

function datYear(value: string | null): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1970 && year <= 2100 ? year : null;
}

function metadataByCrc(entries: AtariDatEntry[], field: "releaseYear"): Map<string, number>;
function metadataByCrc(entries: AtariDatEntry[], field: "genre"): Map<string, string>;
function metadataByCrc(entries: AtariDatEntry[], field: "releaseYear" | "genre"): Map<string, number | string> {
  const result = new Map<string, number | string>();
  for (const entry of entries) {
    const value = entry[field];
    if (entry.crc && value !== null) result.set(entry.crc, value);
  }
  return result;
}

function readableAtariGenre(value: string): string {
  if (/^platform$/i.test(value)) return "Platformer";
  if (/^shoot(?:'em|em) up$/i.test(value)) return "Shooter";
  return readableGenre(value);
}

function genresFromOpenVgdb(value: string | null | undefined): string[] | null {
  if (!value) return null;
  const genres = [...new Set(value.split(",").map((genre) => readableAtariGenre(genre.trim())).filter((genre) => genre && !/^\d+d$/i.test(genre)))].slice(0, 4);
  return genres.length ? genres : null;
}

async function hasSqliteHeader(filename: string): Promise<boolean> {
  try {
    const handle = await open(filename, "r");
    try {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      return bytesRead === header.length && header.equals(Buffer.from("SQLite format 3\0"));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function extractZipEntry(archive: Buffer, expectedName: string): Buffer {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  const minimumEocdSize = 22;
  const searchStart = Math.max(0, archive.length - 65_557);
  let eocdOffset = -1;
  for (let offset = archive.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("The Atari 2600 metadata supplement archive is invalid.");
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let offset = archive.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== centralSignature) break;
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === expectedName) {
      if ((flags & 1) !== 0 || ![0, 8].includes(method) || uncompressedSize > MAX_OPENVGDB_BYTES) {
        throw new Error("The Atari 2600 metadata supplement archive is unsupported.");
      }
      if (archive.readUInt32LE(localOffset) !== localSignature) throw new Error("The Atari 2600 metadata supplement archive is invalid.");
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      const result = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_OPENVGDB_BYTES });
      if (result.byteLength !== uncompressedSize) throw new Error("The Atari 2600 metadata supplement archive is incomplete.");
      return result;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("The Atari 2600 metadata supplement archive does not contain its database.");
}

function atariDisplayName(value: string): string {
  let displayName = value.trim();
  const releaseTag = /\s+\((?:usa|europe|japan|world|brazil|australia|canada|germany|france|proto(?:type)?(?:\s*\d+)?|beta|alt|unl|aftermarket|atari anthology|ntsc|pal(?:\s*\d+hz)?|rev(?:ision)?\s*\w*|v\d[^)]*|en|[a-z]{2}(?:,[a-z]{2})+|\d{4}(?:-[\dx]{2}){0,2}|[^)]*,\s*(?:usa|europe|japan|world)[^)]*)\)\s*$/i;
  let previous: string;
  do {
    previous = displayName;
    displayName = displayName.replace(releaseTag, "").trim();
  } while (displayName !== previous);
  return displayName || normalizeGameFilename(`${value}.a26`);
}

function libretroAtariCoverUrl(name: string): string {
  const coverName = name.replace(/[&*/:`<>?\\|]/g, "_");
  return `https://raw.githubusercontent.com/libretro-thumbnails/Atari_-_2600/master/Named_Boxarts/${encodeURIComponent(coverName)}.png`;
}

function parseCatalog(value: string): RetronianEntry[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new SyntaxError("Metadata catalog is invalid.");
  return parsed.filter((entry): entry is RetronianEntry => Boolean(entry) && typeof entry === "object" && typeof (entry as RetronianEntry).id === "string");
}

function toMetadataMatch(contentHash: string, entry: RetronianEntry, matchedRegion: string | undefined, fallbackDisplayName: string, platform: MetadataPlatformKey): MetadataMatch {
  const englishTitles = (entry.titles ?? []).filter((title) => title.lang === "en");
  const providerDisplayName = englishTitles.find((title) => title.region === matchedRegion)?.text
    ?? englishTitles.find((title) => title.region === "us")?.text
    ?? englishTitles[0]?.text
    ?? entry.id.replace(/-/g, " ");
  const displayName = /[a-z]/.test(providerDisplayName) && !/[A-Z]/.test(providerDisplayName)
    ? fallbackDisplayName
    : providerDisplayName;
  const descriptions = (entry.descriptions ?? []).filter((description) => description.lang === "en");
  const rawDescription = descriptions.find((description) => description.source === "wikipedia_en")?.text
    ?? descriptions.sort((left, right) => right.text.length - left.text.length)[0]?.text
    ?? "";
  const platformName = platforms[platform].displayName;
  const description = conciseDescription(rawDescription, displayName, platformName);
  const releaseYear = yearFrom(entry.first_release_date) ?? yearFrom(rawDescription) ?? (platform === "snes" ? 1991 : 1985);
  const genres = entry.genres?.length ? entry.genres.map(readableGenre) : inferGenres(`${displayName} ${rawDescription}`, platformName);
  const boxArt = (entry.media ?? []).filter((media) => media.kind === "boxart" && media.url.startsWith("https://"));
  const coverUrl = boxArt.find((media) => media.region === matchedRegion)?.url
    ?? boxArt.find((media) => media.region === "us")?.url
    ?? boxArt.find((media) => media.region === "eu")?.url
    ?? boxArt[0]?.url
    ?? null;
  return { providerKey: "retronian", platform, contentHash, canonicalId: entry.id, displayName, releaseYear, description, genres, series: inferSeries(displayName), coverUrl };
}

function conciseDescription(value: string, displayName: string, platformName: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return `${displayName} is a ${platformName} game in your private library.`;
  const sentences = normalized.match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(" ").trim() ?? normalized;
  return sentences.length <= 420 ? sentences : `${sentences.slice(0, 417).trimEnd()}…`;
}

function yearFrom(value?: string): number | null {
  const match = value?.match(/\b(19[7-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : null;
}

function inferGenres(value: string, platformName: string): string[] {
  const rules: Array<[RegExp, string]> = [
    [/role-playing|\brpg\b/i, "RPG"],
    [/platform/i, "Platformer"],
    [/action|beat ['’]?em up|run-and-gun/i, "Action"],
    [/adventure|explor/i, "Adventure"],
    [/puzzle|maze/i, "Puzzle"],
    [/racing|motocross|driving/i, "Racing"],
    [/sport|wrestl|baseball|football|basketball|golf|hockey|boxing/i, "Sports"],
    [/shoot|shmup/i, "Shooter"],
    [/strategy|chess|tactical/i, "Strategy"],
    [/fighting game|one-on-one fight/i, "Fighting"],
  ];
  const genres = rules.filter(([pattern]) => pattern.test(value)).map(([, genre]) => genre).slice(0, 4);
  return genres.length ? genres : [platformName];
}

function readableGenre(value: string): string {
  return value.split(/[-_]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function inferSeries(displayName: string): string | null {
  const numbered = displayName.match(/^(.+?)(?:\s+(?:[IVX]+|\d+)|\s*[:\-])/i)?.[1]?.trim();
  return numbered && numbered.length >= 3 ? numbered : null;
}
