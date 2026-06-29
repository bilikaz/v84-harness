// Agent grounding: the `*` wildcard ceiling in agentPermissions. A graph head (or any agent) sets
// `{ "*": 0, ... }` to restrict itself to ONLY the tools it lists, instead of inheriting the workspace's
// full toolset — so a consolidator with `{ "*": 0 }` gets zero tools and can't reach Fetch/SaveMemory.
import { describe, expect, it } from "vitest";

import { ToolRegistry } from "../src/core/tools/registry.ts";
import { BaseTool } from "../src/core/tools/base.ts";
import type { Config } from "../src/core/config/index.ts";
import type { ToolSpec } from "../src/core/tools/types.ts";

function permTool(name: string) {
  return class extends BaseTool {
    get schema(): ToolSpec {
      return { type: "function", function: { name, description: "", parameters: {} } };
    }
    isPermissioned(): boolean {
      return true;
    }
    async run() {
      return { ok: true, output: "" };
    }
  };
}

const cfg = () => ({ plugins: {} }) as unknown as Config;
const registry = new ToolRegistry(cfg, {
  "/core/tools/Read.ts": { Read: permTool("Read") },
  "/core/tools/Fetch.ts": { Fetch: permTool("Fetch") },
  "/core/tools/SaveMemory.ts": { SaveMemory: permTool("SaveMemory") },
});
const advertised = (agentPermissions: Record<string, 0 | 1 | 2>): string[] =>
  Object.keys(registry.filter({ hasWorkspace: true, agentPermissions })).sort();

describe("agent tool grounding", () => {
  it("`*: 0` plus an allowlist advertises ONLY the listed tools", () => {
    expect(advertised({ "*": 0, Read: 2 })).toEqual(["Read"]);
  });

  it("`*: 0` alone grounds the agent to zero tools", () => {
    expect(advertised({ "*": 0 })).toEqual([]);
  });

  it("without a wildcard, unlisted tools still inherit (prior behaviour)", () => {
    expect(advertised({ Read: 2 })).toEqual(["Fetch", "Read", "SaveMemory"]);
  });
});
