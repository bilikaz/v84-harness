// Shared provider plumbing (ADR-0006) — base-URL normalization (no double prefixes behind reverse proxies) and error bodies.
import { describe, expect, it } from "vitest";

import { baseWithPrefix, expectOk, safeJson } from "../src/llm/util.ts";

describe("baseWithPrefix", () => {
  it("appends the prefix to a bare host", () => {
    expect(baseWithPrefix("https://api.openai.com", "", "/v1")).toBe("https://api.openai.com/v1");
  });

  it("applies the fallback when the base is empty", () => {
    expect(baseWithPrefix("", "https://api.anthropic.com", "/v1")).toBe("https://api.anthropic.com/v1");
  });

  it("yields a relative prefix when base and fallback are empty (web dev proxy case)", () => {
    expect(baseWithPrefix("", "", "/v1")).toBe("/v1");
  });

  it("does not double-suffix a base that already ends with the prefix", () => {
    expect(baseWithPrefix("https://proxy.local/anthropic/v1", "", "/v1")).toBe("https://proxy.local/anthropic/v1");
    expect(baseWithPrefix("https://vllm.local/openai/v1", "", "/v1")).toBe("https://vllm.local/openai/v1");
    expect(baseWithPrefix("https://g.local/v1beta", "", "/v1beta")).toBe("https://g.local/v1beta");
  });

  it("strips trailing slashes before deciding", () => {
    expect(baseWithPrefix("https://api.openai.com/", "", "/v1")).toBe("https://api.openai.com/v1");
    expect(baseWithPrefix("https://proxy.local/v1///", "", "/v1")).toBe("https://proxy.local/v1");
  });
});

describe("expectOk", () => {
  it("passes an ok response through", async () => {
    const res = new Response("{}", { status: 200 });
    await expect(expectOk(res)).resolves.toBe(res);
  });

  it("includes status AND the response body in the error", async () => {
    const res = new Response("invalid api key: sk-…", { status: 401, statusText: "Unauthorized" });
    await expect(expectOk(res)).rejects.toThrow(/401 Unauthorized invalid api key/);
  });
});

describe("safeJson", () => {
  it("parses valid JSON", () => {
    expect(safeJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("falls back to {} on malformed input", () => {
    expect(safeJson("{nope")).toEqual({});
  });
});
