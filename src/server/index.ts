import path from "node:path";
import { loadEnvFile } from "node:process";
import { APPLICATION_ROOT, loadConfig } from "./config.js";
import { createPortalApplication } from "./app.js";

try {
  loadEnvFile(path.join(APPLICATION_ROOT, ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const config = loadConfig();
const portal = createPortalApplication(config);
const server = portal.app.listen(config.port, config.host, () => {
  console.log(`Home Game Portal listening on ${config.host}:${config.port}`);
  void portal.rescan().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Initial Library Source scan did not complete: ${message}`);
  });
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => {
    portal.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
