import { cp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { wikipediaProxyPlugin } from "./scripts/wikipedia-proxy.mjs";

const require = createRequire(import.meta.url);

export default defineConfig(({ mode }) => {
  const desktop = mode === "desktop";
  const publicDir = fileURLToPath(new URL("./public", import.meta.url));
  return {
    base: "/",
    plugins: [
      wikipediaProxyPlugin,
      {
        name: "soma-editor-notices",
        async generateBundle() {
          for (const [fileName, path] of [
            ["licenses/NOTICE.txt", fileURLToPath(new URL("../../NOTICE", import.meta.url))],
            ["licenses/tinymce.md", require.resolve("tinymce/license.md")],
            ["licenses/dompurify.txt", join(dirname(require.resolve("dompurify")), "../LICENSE")],
          ] as const) {
            this.emitFile({ type: "asset", fileName, source: await readFile(path, "utf8") });
          }
        },
      },
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
