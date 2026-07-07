import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Renderer Vite config — shell-agnostic UI, reused verbatim by electron.vite.config.ts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
