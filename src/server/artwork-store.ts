import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { CatalogRepository } from "./catalog-repository.js";
import { resolveLibraryPath } from "./path-security.js";

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

export class ArtworkStore {
  constructor(private readonly artworkRoot: string, private readonly catalog: CatalogRepository) {}

  async get(gameId: string): Promise<{ data: Buffer; contentType: string }> {
    const cachePath = this.cachePath(gameId);
    try {
      const data = await readFile(cachePath);
      return { data, contentType: imageContentType(data) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const source = this.catalog.getArtworkSource(gameId);
    if (!source) throw new Error("Artwork not found.");
    const url = new URL(source);
    if (url.protocol !== "https:") throw new Error("Artwork source is not trusted.");
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Artwork provider did not respond.");
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > MAX_ARTWORK_BYTES) throw new Error("Artwork file is invalid.");
    const contentType = imageContentType(data);
    await mkdir(this.artworkRoot, { recursive: true });
    const temporary = `${cachePath}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, cachePath);
    return { data, contentType };
  }

  async invalidate(gameId: string): Promise<void> {
    try {
      await unlink(this.cachePath(gameId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private cachePath(gameId: string): string {
    if (!/^[a-f0-9]{24}$/.test(gameId)) throw new Error("Artwork identifier is invalid.");
    return resolveLibraryPath(this.artworkRoot, `${gameId}.image`);
  }
}

function imageContentType(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new Error("Artwork format is not supported.");
}
