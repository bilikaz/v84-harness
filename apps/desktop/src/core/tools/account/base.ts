// Account tools — talk to the knowledge API (memory). They run in the RENDERER
// (web: in-process; electron: an in-process registry, NOT bridged to main), where
// core/account.authedFetch lives — so the bearer token never crosses IPC and
// refresh-on-401 just works. canRun() gates them on a connected account.

import { BaseTool } from "../base.ts";
import { isConnected } from "../../account.ts";

export abstract class BaseAccountTool extends BaseTool {
  override canRun(): boolean {
    return isConnected();
  }

  // The clean `{ error }` message off a failed response (e.g. a 503 "encoder is
  // down" the agent can relay), falling back to the status line.
  protected async errText(res: Response): Promise<string> {
    const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => "");
    return msg || `${res.status} ${res.statusText}`;
  }
}
