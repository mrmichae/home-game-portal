import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredGameFile, WebPlayablePlatformKey } from "../domain/types.js";
import { normalizeGameFilename } from "./filename-normalizer.js";
import { assertRealPathWithinRoot, resolveLibraryPath } from "./path-security.js";

const ROM_PLATFORMS: Readonly<Record<string, WebPlayablePlatformKey>> = {
  ".nes": "nes",
  ".sfc": "snes",
  ".smc": "snes",
  ".snes": "snes",
  ".a26": "atari2600",
};

export async function scanGameLibrary(libraryRoot: string): Promise<DiscoveredGameFile[]> {
  const rootRealPath = await realpath(libraryRoot);
  const discovered: DiscoveredGameFile[] = [];
  await visitDirectory(rootRealPath, "", discovered);
  return discovered.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "en-US", { numeric: true }),
  );
}

async function visitDirectory(
  root: string,
  relativeDirectory: string,
  discovered: DiscoveredGameFile[],
): Promise<void> {
  const absoluteDirectory = resolveLibraryPath(root, relativeDirectory || ".");
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  for (const entry of entries) {
    // Finder and archive tools can leave AppleDouble resource forks beside ROMs.
    // They may use a supported ROM extension, but they are filesystem metadata rather than games.
    if (entry.name.startsWith("._") || entry.name === "__MACOSX") continue;
    const relativePath = path.posix.join(
      relativeDirectory.split(path.sep).join(path.posix.sep),
      entry.name,
    );
    const absolutePath = resolveLibraryPath(root, relativePath);
    const stats = await lstat(absolutePath);

    // Library content is untrusted. Symlinks are ignored rather than followed.
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      await visitDirectory(root, relativePath, discovered);
      continue;
    }
    const platform = platformForGameFile(relativePath);
    if (!stats.isFile() || !platform) continue;

    assertRealPathWithinRoot(root, await realpath(absolutePath));
    discovered.push({
      relativePath,
      displayName: normalizeGameFilename(entry.name),
      platform,
      ...await hashFile(absolutePath),
      byteSize: stats.size,
      modifiedAtMs: Math.trunc(stats.mtimeMs),
    });
  }
}

function platformForGameFile(relativePath: string): WebPlayablePlatformKey | undefined {
  const extension = path.extname(relativePath).toLocaleLowerCase("en-US");
  if (extension !== ".bin") return ROM_PLATFORMS[extension];
  const directories = relativePath.split(path.posix.sep).slice(0, -1);
  return directories.some(isAtari2600Directory) ? "atari2600" : undefined;
}

function isAtari2600Directory(directory: string): boolean {
  const normalized = directory.normalize("NFKD").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
  return normalized === "atari" || normalized === "atari2600" || normalized === "2600" || normalized === "vcs";
}

/** @deprecated Use scanGameLibrary for the mixed-platform Library Source. */
export const scanNesLibrary = scanGameLibrary;

async function hashFile(filename: string): Promise<{ contentHash: string; contentSha1: string }> {
  const sha256 = createHash("sha256");
  const sha1 = createHash("sha1");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filename);
    stream.on("data", (chunk) => {
      sha256.update(chunk);
      sha1.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { contentHash: sha256.digest("hex"), contentSha1: sha1.digest("hex") };
}
