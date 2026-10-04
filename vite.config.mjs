import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(root, "src/ui");
const outDir = path.join(root, "public");

// The bridge listens on the host; in dev we proxy the REST + WebSocket
// surface so `npm run dev:ui` can hot-reload against the real backend.
const bridgeTarget = process.env.PHONE_DEV_PROXY || "http://100.108.139.80:45214";

export default defineConfig({
  root: uiRoot,
  publicDir: "public",
  base: "/",
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: ["es2020"],
    cssCodeSplit: false,
    assetsDir: "assets",
    assetsInlineLimit: 2048,
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        entryFileNames: "assets/app-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: (info) => {
          const name = info.name || "";
          if (/\.css$/.test(name)) return "assets/app-[hash][extname]";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: bridgeTarget, changeOrigin: true },
      "/bridge": { target: bridgeTarget, changeOrigin: true, ws: true },
    },
  },
  logLevel: "info",
});
