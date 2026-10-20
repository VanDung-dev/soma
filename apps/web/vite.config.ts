import { defineConfig } from "vite";
import { wikipediaProxyPlugin } from "./scripts/wikipedia-proxy.mjs";

export default defineConfig({
  base: "/",
  plugins: [wikipediaProxyPlugin],
  clearScreen: false,
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2020" },
});
