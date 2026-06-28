// The session's effective BASE system prompt — the resolution the engine sends, minus the runtime
// capability blocks (workspace/browser/memory/plugins) it appends per turn. Shared so the SystemBanner
// shows exactly what the model receives and can't drift from the engine: the session's own (agent)
// system, else the container's instructions, else the user's global prompt, else the built-in default.

import { getContainer } from "../containers.ts";
import { getAppConfig } from "../config/index.ts";
import { fill, pt } from "../prompts.ts";
import type { Session } from "./types.ts";

export function baseSystemFor(session: Session | undefined): string {
  const containerMessage = getContainer(session?.containerId)?.config.instructions as string | undefined;
  return fill(session?.system || containerMessage || getAppConfig().systemPrompt || pt("defaultChat.system"));
}
