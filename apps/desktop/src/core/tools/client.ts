// Mint a call() client from a ToolConfig snapshot — the main-process side of
// the client story. The renderer resolves the snapshot from its stores
// (core/client.ts) and ships it over the bridge; this factory turns it back
// into a Client so main-side tools name services exactly like renderer code.
// No translation happens here: the stores already hold the unified
// {provider, model} target format. MAIN-SAFE: imports nothing that touches
// the renderer stores.

import { createClient, type Client } from "../../llm/index.ts";
import type { ToolConfig } from "./types.ts";

export function clientFromToolConfig(config: ToolConfig): Client {
  return createClient({
    resolve(service) {
      return (service === "main" ? config.main : config.media[service]) ?? null;
    },
  });
}
