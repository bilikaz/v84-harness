// Live verification config — runs the specs under tests-live/ against a REAL
// LLM endpoint (network, slow, needs credentials via env). Deliberately not
// part of `pnpm test`: invoke explicitly with
//   LLM_BASE=… LLM_KEY=… LLM_MODEL=… npx vitest run --config vitest.live.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests-live/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
