// The app context — config + the LLM client, scoped to one host. Host-agnostic: it holds no store
// access, so each host builds its own. The renderer builds one over its live config (core/init.ts);
// the main process builds one from the Config that crossed the bridge (new Ctx(config), the workspace runner).

import { createClient, type LLMClient, type ModelService } from "../llm/index.ts";
import type { Config } from "./config/index.ts";
import type { ConfigLLM } from "./config/llm.ts";

export class Ctx {
  readonly llm: LLMClient;

  // cfg is a live getter (renderer, reads stores) or a fixed Config (main, from the wire).
  constructor(private readonly cfg: Config | (() => Config)) {
    const self = this;
    this.llm = createClient(this, {
      get maxHeals() {
        return self.config.app.llm.maxHealAttempts;
      },
    });
  }

  get config(): Config {
    return typeof this.cfg === "function" ? this.cfg() : this.cfg;
  }

  // The llm client resolves a service's target from the config.
  resolve(service: ModelService): ConfigLLM | null {
    return this.config.llm[service] ?? null;
  }
}
