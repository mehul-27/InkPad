import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // 4. tauri expects a fixed output dir
  build: {
    outDir: "dist",
    // Perf (Fix C): keep the bundle in small, cacheable chunks instead of
    // one monolithic ~1.2MB index chunk. highlight.js and the
    // @codemirror/lang-* packs are already deferred through dynamic
    // imports (languages.ts / markdown.ts) and must stay out of the
    // startup graph; markdown-it and the CodeMirror core are loaded at
    // first paint and get their own files for parsing/caching clarity.
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replace(/\\/g, "/");
          if (!path.includes("/node_modules/")) return undefined;
          if (path.includes("/highlight.js/")) return "highlight";
          if (
            path.includes("/markdown-it") ||
            path.includes("/mdurl") ||
            path.includes("/linkify-it") ||
            path.includes("/entities/") ||
            path.includes("/uc.micro") ||
            path.includes("/decode-uri-component") ||
            path.includes("/punycode")
          ) {
            return "markdown";
          }
          // the codemirror language packs must NOT land here: they are
          // dynamically imported and would become part of the startup graph
          if (path.includes("/@codemirror/") && !path.includes("/@codemirror/lang-")) {
            return "codemirror";
          }
          return undefined;
        },
      },
    },
  },
});
