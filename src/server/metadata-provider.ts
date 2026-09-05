import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredGameFile } from "../domain/types.js";
import { normalizeGameFilename } from "./filename-normalizer.js";

const CATALOG_URL = "https://gamedb.retronian.com/api/v1/fc.json";
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

export interface MetadataMatch {
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

export class RetronianMetadataProvider {
  constructor(
    private readonly cacheRoot: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async match(files: DiscoveredGameFile[]): Promise<MetadataMatch[]> {
    // This provider is the Famicom/NES catalog. SNES titles retain filename
    // metadata (or administrator corrections) until a platform-specific
    // provider is introduced; they must never receive a same-named NES match.
    const nesFiles = files.filter((file) => file.platform !== "snes");
    if (!nesFiles.length) return [];
    const entries = await this.loadCatalog();
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
    return nesFiles.flatMap((file) => {
      const found = byHash.get(file.contentHash.toLocaleLowerCase("en-US"))
        ?? byTitle.get(metadataTitleKey(file.displayName));
      return found ? [toMetadataMatch(file.contentHash, found.entry, found.region, file.displayName)] : [];
    });
  }

  private async loadCatalog(): Promise<RetronianEntry[]> {
    const cachePath = path.join(this.cacheRoot, "retronian-fc.json");
    try {
      return parseCatalog(await readFile(cachePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && error instanceof SyntaxError) {
        // Replace an incomplete or corrupt cache with a fresh provider copy.
      } else if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const response = await this.fetcher(CATALOG_URL, {
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

function parseCatalog(value: string): RetronianEntry[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new SyntaxError("Metadata catalog is invalid.");
  return parsed.filter((entry): entry is RetronianEntry => Boolean(entry) && typeof entry === "object" && typeof (entry as RetronianEntry).id === "string");
}

function toMetadataMatch(contentHash: string, entry: RetronianEntry, matchedRegion: string | undefined, fallbackDisplayName: string): MetadataMatch {
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
  const description = conciseDescription(rawDescription, displayName);
  const releaseYear = yearFrom(entry.first_release_date) ?? yearFrom(rawDescription) ?? 1985;
  const genres = entry.genres?.length ? entry.genres.map(readableGenre) : inferGenres(`${displayName} ${rawDescription}`);
  const boxArt = (entry.media ?? []).filter((media) => media.kind === "boxart" && media.url.startsWith("https://"));
  const coverUrl = boxArt.find((media) => media.region === matchedRegion)?.url
    ?? boxArt.find((media) => media.region === "us")?.url
    ?? boxArt.find((media) => media.region === "eu")?.url
    ?? boxArt[0]?.url
    ?? null;
  return { contentHash, canonicalId: entry.id, displayName, releaseYear, description, genres, series: inferSeries(displayName), coverUrl };
}

function conciseDescription(value: string, displayName: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return `${displayName} is a Nintendo Entertainment System game in your private library.`;
  const sentences = normalized.match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(" ").trim() ?? normalized;
  return sentences.length <= 420 ? sentences : `${sentences.slice(0, 417).trimEnd()}…`;
}

function yearFrom(value?: string): number | null {
  const match = value?.match(/\b(19[7-9]\d|20[0-2]\d)\b/);
  return match ? Number(match[1]) : null;
}

function inferGenres(value: string): string[] {
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
  return genres.length ? genres : ["Nintendo Entertainment System"];
}

function readableGenre(value: string): string {
  return value.split(/[-_]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function inferSeries(displayName: string): string | null {
  const numbered = displayName.match(/^(.+?)(?:\s+(?:[IVX]+|\d+)|\s*[:\-])/i)?.[1]?.trim();
  return numbered && numbered.length >= 3 ? numbered : null;
}
