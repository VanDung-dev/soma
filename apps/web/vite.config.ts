import { cp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { wikipediaProxyPlugin } from "./scripts/wikipedia-proxy.mjs";

const require = createRequire(import.meta.url);
const joditFreePlugins = {
  name: "soma-jodit-free-plugins",
  transform(code: string, id: string) {
    if (!id.replaceAll("\\", "/").endsWith("/jodit/esm/plugins/all.js")) return;
    return code.replace(/^import ["']\.\/(ai-assistant|ai-commands|speech-recognize)\/\1\.js["'];\r?\n/gm, "");
  },
};

export default defineConfig(({ mode }) => {
  const desktop = mode === "desktop";
  const publicDir = fileURLToPath(new URL("./public", import.meta.url));
  const licensePath = fileURLToPath(new URL("../../LICENSE", import.meta.url));
  const noticePath = fileURLToPath(new URL("../../NOTICE", import.meta.url));
  const licenseFiles = [
    ["licenses/LICENSE.txt", licensePath],
    ["licenses/NOTICE.txt", noticePath],
    ["licenses/brotli.txt", fileURLToPath(new URL("../../licenses/brotli.txt", import.meta.url))],
    ["licenses/lesson-content.txt", fileURLToPath(new URL("../../licenses/lesson-content.txt", import.meta.url))],
    ["licenses/squoosh.txt", fileURLToPath(new URL("../../licenses/squoosh.txt", import.meta.url))],
    ["licenses/jodit.txt", require.resolve("jodit/LICENSE.txt")],
    ["licenses/dompurify.txt", join(dirname(require.resolve("dompurify")), "../LICENSE")],
  ] as const;
  return {
    base: "/",
    plugins: [
      joditFreePlugins,
      wikipediaProxyPlugin,
      {
        name: "soma-editor-notices",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = request.url?.split("?", 1)[0];
            const path = licenseFiles.find(([fileName]) => `/${fileName}` === pathname)?.[1];
            if (!path) return next();
            void readFile(path, "utf8").then(text => {
              response.setHeader("Content-Type", "text/plain; charset=utf-8");
              response.end(text);
            }, next);
          });
        },
        async generateBundle() {
          for (const [fileName, path] of licenseFiles) {
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
    optimizeDeps: {
      include: ["jodit", "jodit/esm/modules/widget/index.js", "jodit/esm/plugins/all.js"],
      rolldownOptions: { plugins: [joditFreePlugins] },
    },
    server: { port: 5173, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
    build: {
      target: "es2020",
      outDir: desktop ? "dist-desktop" : "dist",
      copyPublicDir: !desktop,
    },
  };
});
