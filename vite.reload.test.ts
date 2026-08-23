import { createServer } from "vite";
import { describe, expect, it } from "vitest";

describe("development page lifecycle", () => {
  it("does not enable hot-reload machinery that can reload an idle page", async () => {
    const server = await createServer({
      configFile: new URL("./vite.config.ts", import.meta.url).pathname,
      server: { host: "127.0.0.1", port: 0 },
    });

    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Vite did not bind a test port.");
      const html = await fetch(`http://127.0.0.1:${address.port}/`).then((response) => response.text());

      expect(server.config.server.hmr).toBe(false);
      expect(html).not.toContain("/@react-refresh");
    } finally {
      await server.close();
    }
  });
});
