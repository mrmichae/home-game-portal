import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";

afterEach(() => vi.unstubAllEnvs());

describe("deployment configuration", () => {
  it("uses ROM_LIBRARY_PATH as the Library Source default", () => {
    vi.stubEnv("ROM_LIBRARY_PATH", "configured-roms");
    vi.stubEnv("LIBRARY_ROOT", "legacy-library");

    expect(loadConfig("/portal").defaultLibraryRoot).toBe(path.resolve("/portal", "configured-roms"));
  });

  it("keeps LIBRARY_ROOT as a legacy fallback", () => {
    vi.stubEnv("ROM_LIBRARY_PATH", "");
    vi.stubEnv("LIBRARY_ROOT", "legacy-library");

    expect(loadConfig("/portal").defaultLibraryRoot).toBe(path.resolve("/portal", "legacy-library"));
  });

  it("resolves writable and static paths from the application root", () => {
    vi.stubEnv("DATA_DIR", "state/data");
    vi.stubEnv("SAVES_DIR", "state/saves");

    expect(loadConfig("/portal")).toMatchObject({
      dataDir: path.resolve("/portal", "state/data"),
      savesDir: path.resolve("/portal", "state/saves"),
      migrationsDir: path.resolve("/portal", "migrations"),
      publicDir: path.resolve("/portal", "public"),
      clientDir: path.resolve("/portal", "dist/client"),
    });
  });

  it("validates the listening port", () => {
    vi.stubEnv("PORT", "not-a-port");
    expect(() => loadConfig("/portal")).toThrow("PORT must be an integer between 1 and 65535");
  });
});
