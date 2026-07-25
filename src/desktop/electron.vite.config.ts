import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { main: resolve(__dirname, "electron/main.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { preload: resolve(__dirname, "electron/preload.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "renderer"),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "renderer/index.html") },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "renderer/src"),
      },
    },
    plugins: [react()],
  },
});
