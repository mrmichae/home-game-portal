import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const applicationRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, applicationRoot, "");
  const serverUrl = environment.DEV_SERVER_URL ?? "http://127.0.0.1:8090";
  return {
    plugins: [react()],
    root: applicationRoot,
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
    },
    server: {
      host: environment.DEV_UI_HOST ?? "0.0.0.0",
      port: parseDevelopmentPort(environment.DEV_UI_PORT),
      // A dropped HMR WebSocket makes Vite reload the document when it reconnects.
      // The portal is commonly opened through LAN proxies whose idle timeout is
      // shorter than a play session, so preserve the page/runtime lifecycle and
      // require an intentional browser refresh after development changes.
      hmr: false,
      proxy: {
        "/api": serverUrl,
        "/health": serverUrl,
      },
    },
  };
});

function parseDevelopmentPort(value: string | undefined): number {
  if (value === undefined) return 5173;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DEV_UI_PORT must be an integer between 1 and 65535.");
  }
  return port;
}
