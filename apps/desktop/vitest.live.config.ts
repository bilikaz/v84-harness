// Live verification config — runs tests-live/ against a real LLM endpoint (needs LLM_BASE/LLM_KEY/LLM_MODEL env); deliberately not part of `pnpm test`.
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
