import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanGameLibrary } from "../library-scanner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("mixed Game Library Source scanning", () => {
  it("discovers nested NES and SNES files, identifies their platforms, and ignores other content and symlinks", async () => {
    const root = await temporaryDirectory("portal-library-");
    const outside = await temporaryDirectory("portal-outside-");
    await mkdir(path.join(root, "nes", "favorites"), { recursive: true });
    await mkdir(path.join(root, "SNES"), { recursive: true });
    const gameBytes = Buffer.from("NES fixture bytes");
    await writeFile(path.join(root, "nes", "favorites", "mega_man_2_(USA).nes"), gameBytes);
    await writeFile(path.join(root, "nes", "favorites", "._mega_man_2_(USA).nes"), Buffer.alloc(4_096));
    await writeFile(path.join(root, "SNES", "Chrono Trigger (USA).sfc"), "sfc fixture");
    await writeFile(path.join(root, "SNES", "EarthBound.smc"), "smc fixture");
    await writeFile(path.join(root, "SNES", "Super Metroid.snes"), "snes fixture");
    await writeFile(path.join(root, "SNES", "._ignored.sfc"), "sidecar");
    await writeFile(path.join(root, "nes", "notes.txt"), "ignore me");
    await writeFile(path.join(outside, "outside.nes"), "outside");
    await symlink(path.join(outside, "outside.nes"), path.join(root, "nes", "linked.nes"));

    const discovered = await scanGameLibrary(root);

    expect(discovered).toHaveLength(4);
    expect(discovered).toEqual(expect.arrayContaining([expect.objectContaining({
      relativePath: "nes/favorites/mega_man_2_(USA).nes",
      displayName: "Mega Man 2",
      platform: "nes",
      byteSize: gameBytes.byteLength,
      contentHash: createHash("sha256").update(gameBytes).digest("hex"),
    }), expect.objectContaining({ relativePath: "SNES/Chrono Trigger (USA).sfc", displayName: "Chrono Trigger", platform: "snes" }),
    expect.objectContaining({ relativePath: "SNES/EarthBound.smc", displayName: "EarthBound", platform: "snes" }),
    expect.objectContaining({ relativePath: "SNES/Super Metroid.snes", displayName: "Super Metroid", platform: "snes" })]));
  });

  it("sees a newly added file on the next administrator scan", async () => {
    const root = await temporaryDirectory("portal-rescan-");
    await writeFile(path.join(root, "first.nes"), "first");
    expect(await scanGameLibrary(root)).toHaveLength(1);

    await writeFile(path.join(root, "second.nes"), "second");
    expect(await scanGameLibrary(root)).toHaveLength(2);
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
