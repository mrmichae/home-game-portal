import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanNesLibrary } from "../library-scanner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("NES Library Source scanning", () => {
  it("discovers nested .nes files, hashes them, and ignores other content and symlinks", async () => {
    const root = await temporaryDirectory("portal-library-");
    const outside = await temporaryDirectory("portal-outside-");
    await mkdir(path.join(root, "nes", "favorites"), { recursive: true });
    const gameBytes = Buffer.from("NES fixture bytes");
    await writeFile(path.join(root, "nes", "favorites", "mega_man_2_(USA).nes"), gameBytes);
    await writeFile(path.join(root, "nes", "notes.txt"), "ignore me");
    await writeFile(path.join(outside, "outside.nes"), "outside");
    await symlink(path.join(outside, "outside.nes"), path.join(root, "nes", "linked.nes"));

    const discovered = await scanNesLibrary(root);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
      relativePath: "nes/favorites/mega_man_2_(USA).nes",
      displayName: "Mega Man 2",
      byteSize: gameBytes.byteLength,
      contentHash: createHash("sha256").update(gameBytes).digest("hex"),
    });
  });

  it("sees a newly added file on the next administrator scan", async () => {
    const root = await temporaryDirectory("portal-rescan-");
    await writeFile(path.join(root, "first.nes"), "first");
    expect(await scanNesLibrary(root)).toHaveLength(1);

    await writeFile(path.join(root, "second.nes"), "second");
    expect(await scanNesLibrary(root)).toHaveLength(2);
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
