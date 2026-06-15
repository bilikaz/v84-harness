// Web harness init — sets up localStorage, creates Ctx, installs tools + the browser host api.
// Called once from renderer/main.tsx. Returns the app context.

import { Ctx } from "../core/ctx.ts";
import { StorageEngine, RemoteStorage, type Storage } from "../core/storage/index.ts";
import { hydrateConsumers } from "../core/storage/consumer.ts";
import { IdbStorage } from "./idbStorage.ts";
import { LocalStorage } from "./localStorage.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import { attachAccount, authedFetch, isConnected } from "../core/account.ts";
import { initAppConfig } from "../core/config/app.ts";
import { initSettings } from "../core/settings.ts";
import { initWorkspaces } from "../core/workspaces.ts";
import { initAgents } from "../core/agents.ts";
import { initUi } from "../core/ui.ts";
import type { HostApi, MediaModelsResult, MediaEndpoint } from "../core/host.ts";
import { errorMessage } from "../lib/errors.ts";
import { rootLog } from "../lib/logger/index.ts";

// Web runs all in-process (renderer): general + account tools (no workspace/fs tier).
const MODULES = {
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../core/tools/account/*.ts", { eager: true }),
};
const log = rootLog.child("storage");

// The local web backend baseline: IndexedDB (larger quota), falling back to
// localStorage. Log why we fell back — a later quota wall on the ~5 MB
// localStorage tier otherwise has no diagnostic trail.
async function localBackend(): Promise<Storage> {
  try {
    return await IdbStorage.create();
  } catch (e) {
    log.warn("idb_unavailable", { hint: "falling back to localStorage (~5 MB quota)", error: errorMessage(e) });
    return LocalStorage.create();
  }
}

// The browser host api: save = download via an <a>, mediaModels = a direct fetch. No folder picker in the browser.
function browserHost(): HostApi {
  // The browser can't observe save vs. cancel — it triggers a download and resolves with the filename it used.
  const download = (dataUrl: string, suggestedName?: string): Promise<string | null> => {
    const name = suggestedName ?? "download";
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    document.body.appendChild(a); // some browsers only fire the download when the anchor is in the DOM
    a.click();
    a.remove();
    return Promise.resolve(name);
  };
  return {
    saveImage: download,
    saveVideo: download,
    async mediaModels(ep: MediaEndpoint): Promise<MediaModelsResult> {
      if (!ep.baseUrl) return { ok: false, models: [], error: "no base URL set" };
      try {
        const res = await fetch(`${ep.baseUrl.replace(/\/$/, "")}/models`, {
          headers: ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {},
        });
        if (!res.ok) return { ok: false, models: [], error: `${res.status} ${res.statusText}` };
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
        return { ok: true, models };
      } catch (e) {
        return { ok: false, models: [], error: errorMessage(e) };
      }
    },
  };
}

export async function init(): Promise<Ctx> {
  // Engine = local baseline + remote toggled on when the account is connected.
  const local = await localBackend();
  const ctx = new Ctx(new StorageEngine(local, isConnected() ? new RemoteStorage(authedFetch) : null));

  // Construct the ctx-injected consumers, then load them all from the backend.
  initAppConfig(ctx);
  initSettings(ctx);
  initWorkspaces(ctx);
  initAgents(ctx);
  initUi(ctx);
  attachAccount(ctx);
  await hydrateConsumers();

  const reg = new ToolRegistry(ctx.llm, MODULES);
  ctx.tools = {
    filter: (params) => reg.filter(params),
    run: (call) => reg.run(call),
    cancel: (id) => reg.cancel(id),
  };
  ctx.api = browserHost();
  return ctx;
}
