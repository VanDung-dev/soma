import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  clearScreen: false,
  server: { port: 5173, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2020" },
});
