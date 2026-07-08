import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Renderer Vite config — shell-agnostic UI, reused verbatim by electron.vite.config.ts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The boot picks its platform via top-level await (main.tsx) — needs es2022, above vite's default.
    target: "es2022",
    rollupOptions: {
      // Node-only tool helpers (imageSave & the fs base) are reachable ONLY via dynamic import behind
      // cwd guards — never executed in a browser. External keeps rollup from binding node: named
      // exports against its empty browser stub; the emitted chunks simply never load on web.
      external: [/^node:/],
    },
  },
  server: {
    proxy: {
      // Provider client uses baseUrl "/llm" so browser calls stay same-origin (no CORS); Vite strips the prefix and forwards.
      "/llm": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm/, ""),
      },
    },
  },
});
