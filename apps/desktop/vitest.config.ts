// Vitest config — node environment, plain TS, none of the app's Vite plugins
// (tests target pure logic; nothing under test needs React or Tailwind).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
