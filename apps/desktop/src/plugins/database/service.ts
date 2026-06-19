// The Database plugin's stateful service — its communication core, a module-level singleton in the MAIN
// process. Live connection pools keyed by connection name (engine-agnostic OpenConn handles — the driver
// owns the native pool). `resolve()` is the ONE place a pool is opened (reuse the live one, else establish
// from the saved/supplied password, else throw a clear message) — connect/query/ping all go through it, so
// establishment isn't duplicated. Ephemeral process state (not config, not plugin_data); a supplied
// password is transient and never persisted.
//
// Engine specifics live in drivers/ (picked by connection.engine); this file never imports a DB library.
// `rpc` is the surface the plugin's renderer UI invokes over the bridge (electron/pluginServices.ts) —
// connect / disconnect / status. Agent-facing operations are the tools (query, test), which call in directly.

import type { DbConnection } from "./types.ts";
import type { OpenConn, QueryResult } from "./drivers/types.ts";
import { drivers } from "./drivers/index.ts";

const pools = new Map<string, OpenConn>();

// Connection-state subscribers. The host (electron/pluginServices.ts) subscribes and forwards to the
// renderer, so the UI reflects EVERY change — including pools opened by an agent query's auto-connect,
// not just panel actions. Emits ("connections", <live names>) on each change.
type Emit = (type: string, payload: unknown) => void;
const sinks = new Set<Emit>();
export function subscribe(emit: Emit): void {
  sinks.add(emit);
}
function notify(): void {
  const live = [...pools.keys()];
  for (const s of sinks) s("connections", live);
}

// The ONE place a connection is resolved. Reuse the live pool, or establish a new one (via the engine's
// driver) and VALIDATE it with probe() — so every failure mode surfaces here with its own message (server
// unreachable, access denied, unknown host, …), not just the missing-password case. Passing a password
// forces a fresh pool (manual connect with a transient password). Throws on any failure; callers surface
// the message verbatim. The bad pool is torn down so a failed attempt never lingers.
async function resolve(c: DbConnection, password?: string): Promise<OpenConn> {
  const live = pools.get(c.name);
  if (live && password === undefined) return live;
  const pw = password ?? c.password;
  if (!pw) throw new Error(`connection "${c.name}" has no saved password — open the Database panel and connect manually`);
  if (live) await disconnect(c.name);
  const conn = await drivers[c.engine].open(c, pw);
  try {
    await conn.probe(); // the actual connect — throws ECONNREFUSED / access-denied / etc.
  } catch (e) {
    await conn.end().catch(() => undefined);
    throw e;
  }
  pools.set(c.name, conn);
  notify();
  return conn;
}

export function isConnected(name: string): boolean {
  return pools.has(name);
}

export function liveConnections(): string[] {
  return [...pools.keys()];
}

export async function disconnect(name: string): Promise<void> {
  const conn = pools.get(name);
  if (!conn) return;
  pools.delete(name);
  notify();
  await conn.end().catch(() => undefined);
}

// Establish (or re-establish) the connection — resolve() already validates it, so a forced reconnect
// with a transient password surfaces any failure (bad password, server down, …).
export async function connect(c: DbConnection, password?: string): Promise<void> {
  await resolve(c, password);
}

// Liveness check (the test tool) — resolve (validates a new pool) then probe again, so a live-but-dead
// pool is also caught, not just a fresh connect.
export async function ping(c: DbConnection): Promise<void> {
  await (await resolve(c)).probe();
}

export type { QueryResult };

export async function query(c: DbConnection, sql: string): Promise<QueryResult> {
  return (await resolve(c)).query(sql);
}

// UI-invokable surface (not agent tools). connect takes the connection def + a transient password.
export const rpc = {
  connect: (c: DbConnection, password?: string) => connect(c, password),
  disconnect: (name: string) => disconnect(name),
  status: () => liveConnections(),
};

// Lifecycle. install: nothing to bring to life — connections are opened on demand (agent query) or
// manually (panel), never eagerly. uninstall (plugin disabled): tear down every live pool.
export function install(): void {}
export async function uninstall(): Promise<void> {
  await Promise.all([...pools.keys()].map(disconnect));
}
