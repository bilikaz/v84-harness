// A FEATURE registers its surfaces through this Registry — the object each
// features/**/register.ts receives. Today that's HTTP routers (mount). When
// Inngest lands, add `inngest(stage)` here + a `stages` array on RegistryState
// + the webhook host loop — nothing else changes. (Pattern from task-builder.)

import type { Env, Hono } from "hono";
import type { InngestFunction } from "inngest";

export interface MountedRouter {
  basePath: string;
  // Routers carry their own env (e.g. AuthEnv for auth'd Variables); the
  // registry holds them heterogeneously, so the stored type is env-erased.
  router: Hono<any>;
}

// Accumulated registrations, read by the hosts (http/app.ts) after the boot scan:
// HTTP routers + Inngest functions.
export interface RegistryState {
  routers: MountedRouter[];
  functions: InngestFunction.Any[];
}

// What register(r) is handed. One method per surface kind.
export interface Registry {
  mount<E extends Env>(basePath: string, router: Hono<E>): void;
  inngest(fn: InngestFunction.Any): void;
}

export function createRegistry(): { registry: Registry; state: RegistryState } {
  const state: RegistryState = { routers: [], functions: [] };
  const registry: Registry = {
    mount: (basePath, router) => void state.routers.push({ basePath, router }),
    inngest: (fn) => void state.functions.push(fn),
  };
  return { registry, state };
}
