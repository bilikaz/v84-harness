// Renderer-side client for a plugin's main-side service (its service.ts `rpc` methods), over ctx.api.
// Used by plugin UI for operations that are NOT agent tools — e.g. MySQL connect / disconnect / status.
// Desktop only: the host has no plugin-service bridge on web, so callers get a clean { ok: false }.

import type { Ctx } from "../ctx.ts";
import { errorMessage } from "../../lib/errors.ts";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function invokePluginService<T = unknown>(ctx: Ctx, slug: string, method: string, ...args: unknown[]): Promise<ServiceResult<T>> {
  const invoke = ctx.api.invokePlugin;
  if (!invoke) return { ok: false, error: "Plugin services run in the desktop app only." };
  try {
    return { ok: true, value: (await invoke(slug, method, args)) as T };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
