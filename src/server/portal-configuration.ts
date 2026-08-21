import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import type { AdministrationSettings, LibrarySourceConfiguration, ScanStatus } from "../domain/types.js";
import { platforms } from "../domain/platforms.js";
import type { CatalogRepository } from "./catalog-repository.js";

export class PortalConfiguration {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly deploymentDefaultLibraryRoot: string,
  ) {}

  initialize(): void {
    this.catalog.ensureLibrarySource(path.resolve(this.deploymentDefaultLibraryRoot));
  }

  settings(scan: ScanStatus): AdministrationSettings {
    return {
      library: this.inspectLibrarySource(),
      emulators: this.catalog.listEmulatorProfiles(),
      scan,
    };
  }

  updateLibraryRoot(candidate: string): LibrarySourceConfiguration {
    const rootPath = validateRomLibraryPath(candidate);
    this.catalog.updateLibrarySourceRoot(rootPath);
    return this.inspectLibrarySource();
  }

  inspectLibrarySource(): LibrarySourceConfiguration {
    const source = this.catalog.getLibrarySource();
    try {
      validateRomLibraryPath(source.rootPath);
      return {
        rootPath: source.rootPath,
        platform: platforms[source.platformKey],
        available: true,
        statusMessage: "Directory is available and readable.",
        lastScannedAt: source.lastScannedAt,
      };
    } catch (error) {
      return {
        rootPath: source.rootPath,
        platform: platforms[source.platformKey],
        available: false,
        statusMessage: error instanceof Error ? error.message : "The configured directory is unavailable.",
        lastScannedAt: source.lastScannedAt,
      };
    }
  }
}

export function validateRomLibraryPath(candidate: string): string {
  const value = candidate.trim();
  if (!value) throw new Error("Enter a ROM Library location.");
  if (!path.isAbsolute(value)) throw new Error("ROM Library location must be an absolute server path.");
  const rootPath = path.normalize(value);
  let stats;
  try {
    stats = statSync(rootPath);
  } catch {
    throw new Error("That directory does not exist on the server.");
  }
  if (!stats.isDirectory()) throw new Error("ROM Library location must be a directory.");
  try {
    accessSync(rootPath, constants.R_OK);
  } catch {
    throw new Error("That directory is not readable by the Portal server.");
  }
  return rootPath;
}
