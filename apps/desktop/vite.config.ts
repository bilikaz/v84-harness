import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Plain Vite + React + Tailwind v4. This is the renderer/UI — shell-agnostic
// (browser-runnable for fast iteration). A desktop shell (Electron/Tauri) wraps
// this `dist` later.
//
// Dev proxy: `/llm/*` → the OpenAI-compatible endpoint, stripping the `/llm`
// prefix. The provider client uses baseUrl "/llm", so browser calls stay
// same-origin (no CORS) and Vite forwards them server-side. Change the target
// or set a direct baseUrl in Settings for other endpoints.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/llm": {
        target: "https://llm.v84.eu:2083",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/llm/, ""),
      },
    },
  },
});
