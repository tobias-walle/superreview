import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("client"),
  publicDir: false,
  plugins: [react()],
  resolve: { alias: { "@": resolve(".") } },
  build: { outDir: resolve("dist-cli/web"), emptyOutDir: true },
});
