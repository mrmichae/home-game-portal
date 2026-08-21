import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLibraryPath, UnsafeLibraryPathError } from "../path-security.js";

describe("Library Source path protection", () => {
  const root = path.resolve("/library");

  it("allows a nested relative game path", () => {
    expect(resolveLibraryPath(root, "nes/My Game.nes")).toBe(path.join(root, "nes/My Game.nes"));
  });

  it.each([
    "../outside.nes",
    "nes/../../outside.nes",
    "..\\outside.nes",
    "/etc/passwd",
    "nes/evil\0.nes",
    "",
  ])("rejects unsafe path %s", (candidate) => {
    expect(() => resolveLibraryPath(root, candidate)).toThrow(UnsafeLibraryPathError);
  });
});
