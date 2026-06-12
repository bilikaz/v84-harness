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
        target: "https://llm.v84.eu:2083",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/llm/, ""),
      },
    },
  },
});
