import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The SPA is served from the local CLI, so large rarely used grammar chunks do not affect a remote CDN.
const LOCAL_GRAMMAR_CHUNK_WARNING_LIMIT_KB = 800;

export default defineConfig({
  root: resolve("client"),
  publicDir: false,
  plugins: [react()],
  resolve: { alias: { "@": resolve(".") } },
  build: {
    outDir: resolve("dist-cli/web"),
    emptyOutDir: true,
    chunkSizeWarningLimit: LOCAL_GRAMMAR_CHUNK_WARNING_LIMIT_KB,
  },
});
