// Mint a call() client from a ToolConfig snapshot — MAIN-SAFE: imports nothing that touches the renderer stores.

import { createClient, type Client } from "../../llm/index.ts";
import type { ToolConfig } from "./types.ts";

export function clientFromToolConfig(config: ToolConfig): Client {
  return createClient({
    resolve(service) {
      return (service === "main" ? config.main : config.media[service]) ?? null;
    },
  });
}
