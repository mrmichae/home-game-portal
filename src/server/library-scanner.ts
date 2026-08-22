import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredGameFile } from "../domain/types.js";
import { normalizeGameFilename } from "./filename-normalizer.js";
import { assertRealPathWithinRoot, resolveLibraryPath } from "./path-security.js";

export async function scanNesLibrary(libraryRoot: string): Promise<DiscoveredGameFile[]> {
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
    // They may end in .nes, but they are filesystem metadata rather than games.
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
    if (!stats.isFile() || path.extname(entry.name).toLocaleLowerCase("en-US") !== ".nes") {
      continue;
    }

    assertRealPathWithinRoot(root, await realpath(absolutePath));
    discovered.push({
      relativePath,
      displayName: normalizeGameFilename(entry.name),
      contentHash: await sha256File(absolutePath),
      byteSize: stats.size,
      modifiedAtMs: Math.trunc(stats.mtimeMs),
    });
  }
}

async function sha256File(filename: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
