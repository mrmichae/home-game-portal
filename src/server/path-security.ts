import path from "node:path";

export class UnsafeLibraryPathError extends Error {
  constructor() {
    super("The requested game file is outside the configured Library Source.");
    this.name = "UnsafeLibraryPathError";
  }
}

export function resolveLibraryPath(libraryRoot: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).some((segment) => segment === "..")
  ) {
    throw new UnsafeLibraryPathError();
  }

  const root = path.resolve(libraryRoot);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new UnsafeLibraryPathError();
  }
  return candidate;
}

export function assertRealPathWithinRoot(libraryRoot: string, realPath: string): void {
  const root = path.resolve(libraryRoot);
  const candidate = path.resolve(realPath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new UnsafeLibraryPathError();
  }
}
