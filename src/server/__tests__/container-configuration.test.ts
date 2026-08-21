import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("container deployment contract", () => {
  it("keeps the game library read-only and application state persistent", async () => {
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(compose).toContain("source: ${ROM_LIBRARY_HOST_PATH:-./sample-library}");
    expect(compose).toContain("target: /roms");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("portal-data:/data");
    expect(compose).toContain("portal-saves:/saves");
    expect(compose).toContain("portal-artwork:/artwork");
  });

  it("runs the production image as an unprivileged, health-checked process", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    const compose = await readFile("docker-compose.yml", "utf8");

    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain('CMD ["node", "dist/server/index.js"]');
    expect(dockerfile).toContain("COPY --chown=node:node THIRD_PARTY_LICENSES ./THIRD_PARTY_LICENSES");
    expect(dockerfile).toContain("COPY --chown=node:node THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("cap_drop:");
  });

  it("excludes private and generated data from the build context", async () => {
    const dockerignore = await readFile(".dockerignore", "utf8");

    for (const entry of ["node_modules", "dist", "runtime", ".git", ".env", "outputs", "work", "sample-library/**/*.nes", "sample-library/**/*.zip"]) {
      expect(dockerignore.split("\n")).toContain(entry);
    }
  });
});
