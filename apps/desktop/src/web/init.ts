// Web harness init — sets up localStorage, creates Ctx, installs tools + the browser host api.
// Called once from renderer/main.tsx. Returns the app context.

import { Ctx } from "../core/ctx.ts";
import { StorageEngine, type Storage } from "../core/storage/index.ts";
import { IdbStorage } from "./idbStorage.ts";
import { LocalStorage } from "./localStorage.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import type { HostApi, MediaModelsResult, MediaEndpoint } from "../core/host.ts";
import { errorMessage } from "../lib/errors.ts";

const MODULES = import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true });

// Best web backend first: IndexedDB (larger quota), falling back to localStorage.
async function pickBackend(): Promise<Storage> {
  try {
    return await IdbStorage.create();
  } catch {
    return LocalStorage.create();
  }
}

// The browser host api: save = download via an <a>, mediaModels = a direct fetch. No folder picker in the browser.
function browserHost(): HostApi {
  const download = (dataUrl: string, suggestedName?: string): Promise<string | null> => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = suggestedName ?? "download";
    a.click();
    return Promise.resolve(suggestedName ?? null);
  };
  return {
    saveImage: download,
    saveVideo: download,
    async mediaModels(ep: MediaEndpoint): Promise<MediaModelsResult> {
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
  const ctx = new Ctx(new StorageEngine(await pickBackend()));
  const reg = new ToolRegistry(ctx.llm, MODULES);
  ctx.tools = {
    filter: (params) => reg.filter(params),
    run: (call) => reg.run(call),
    cancel: (id) => reg.cancel(id),
  };
  ctx.api = browserHost();
  return ctx;
}
