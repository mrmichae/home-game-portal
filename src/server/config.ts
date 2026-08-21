import path from "node:path";
import { fileURLToPath } from "node:url";

export const APPLICATION_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface AppConfig {
  host: string;
  port: number;
  defaultLibraryRoot: string;
  dataDir: string;
  savesDir: string;
  artworkDir: string;
  migrationsDir: string;
  publicDir: string;
  clientDir: string;
}

export function loadConfig(applicationRoot = APPLICATION_ROOT): AppConfig {
  const dataDir = path.resolve(applicationRoot, process.env.DATA_DIR ?? "runtime/data");
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: parsePort(process.env.PORT),
    defaultLibraryRoot: path.resolve(applicationRoot, process.env.ROM_LIBRARY_PATH || process.env.LIBRARY_ROOT || "sample-library"),
    dataDir,
    savesDir: path.resolve(applicationRoot, process.env.SAVES_DIR ?? "runtime/saves"),
    artworkDir: path.resolve(applicationRoot, process.env.ARTWORK_DIR ?? path.join(dataDir, "artwork")),
    migrationsDir: path.resolve(applicationRoot, "migrations"),
    publicDir: path.resolve(applicationRoot, "public"),
    clientDir: path.resolve(applicationRoot, "dist/client"),
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8090;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}
