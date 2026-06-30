// Regression: invokePluginService dispatch contract. The glob resolves the real src/plugins/*/service.ts
// (database + mcp have one; review is serviceless — graph/agents only). Guards the boot crash where an
// enabled serviceless plugin's "install" lifecycle phase threw `unknown plugin` instead of no-opping.
import { describe, expect, it } from "vitest";

import { invokePluginService } from "../src/electron/pluginServices.ts";

describe("invokePluginService", () => {
  it("no-ops install/uninstall for a serviceless plugin instead of throwing", async () => {
    await expect(invokePluginService("review", "install", [])).resolves.toBeUndefined();
    await expect(invokePluginService("review", "uninstall", [])).resolves.toBeUndefined();
  });

  it("still throws on an rpc call to a plugin with no service", async () => {
    await expect(invokePluginService("review", "status", [])).rejects.toThrow(/unknown plugin "review"/);
  });

  it("still throws on an unknown method of a real service", async () => {
    await expect(invokePluginService("database", "nope", [])).rejects.toThrow(/unknown plugin service "database\.nope"/);
  });
});
