import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// 仅用于 `pnpm dev:renderer` 独立调试；正式开发用 `pnpm dev`（electron-vite 集成）
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "../out/renderer",
    emptyOutDir: true,
  },
});
