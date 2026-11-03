import { cp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { wikipediaProxyPlugin } from "./scripts/wikipedia-proxy.mjs";

export default defineConfig(({ mode }) => {
  const desktop = mode === "desktop";
  const publicDir = fileURLToPath(new URL("./public", import.meta.url));
  return {
    base: "/",
    plugins: [
      wikipediaProxyPlugin,
      desktop && {
        name: "soma-desktop-public-assets",
        apply: "build",
        writeBundle({ dir }) {
          if (!dir) return;
          return cp(publicDir, dir, {
            recursive: true,
            filter: source => source !== join(publicDir, "models"),
          });
        },
      },
    ],
    clearScreen: false,
    server: { port: 5173, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
    build: {
      target: "es2020",
      outDir: desktop ? "dist-desktop" : "dist",
      copyPublicDir: !desktop,
    },
  };
});
