// Wires routes onto the given Hono app: cross-cutting middleware + the
// boot-scanned feature routers. Add a feature's register.ts and it mounts here
// automatically (see core/registry.ts).

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve as inngestServe } from "inngest/hono";

import { inngest } from "../inngest/client.ts";
import type { RegistryState } from "../core/feature.ts";
import { rootLogger } from "../core/logger.ts";
import { errorMessage, ServiceDownError } from "../lib/errors.ts";

export function mountRoutes(app: Hono, scanned: RegistryState): void {
  // One place to turn a thrown handler error into a response: a missing global handler means an
  // uncaught error (e.g. the DB is down during /logout or a token rotation) becomes Hono's bare 500
  // with no log. Log it, and map ServiceDownError to 503; never leak internals to the client.
  app.onError((err, c) => {
    if (err instanceof ServiceDownError) return c.json({ error: err.message }, 503);
    rootLogger.error({ err: errorMessage(err), path: c.req.path }, "request.unhandled");
    return c.json({ error: "internal error" }, 500);
  });

  // CORS — INTENTIONALLY reflects EVERY origin (allow-all). Clients call from many origins: the Electron
  // renderer is http://localhost:5173 in dev and a file:// / app origin when packaged, plus web clients.
  // Safe to be open because auth is Bearer-only (no cookies) — there is no ambient credential a foreign
  // origin could ride on, and `*` + credentials is a spec violation browsers reject anyway.
  // DO NOT narrow this to a hardcoded allow-list without enumerating every real client origin (incl. the
  // dev localhost) — tightening it to one domain is exactly what broke local dev last time.
  app.use(
    "/*",
    cors({
      origin: (origin) => origin ?? "*", // reflect the caller's origin; "*" only for the no-Origin case
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Device-Name"],
      maxAge: 600,
    }),
  );

  // Liveness — no DB dependency.
  app.get("/health", (c) => c.json({ ok: true }));

  // Inngest webhook — the orchestration server syncs + invokes our functions here.
  // Machine-to-machine, so NOT under requireAuth: it's gated by Inngest's request
  // signature (INNGEST_SIGNING_KEY) — only the Inngest server can produce valid
  // invocations; forged/unsigned calls are rejected by the serve handler.
  const inngestHandler = inngestServe({ client: inngest, functions: scanned.functions });
  app.on(["GET", "POST", "PUT"], "/inngest", (c) => inngestHandler(c));

  for (const { basePath, router } of scanned.routers) app.route(basePath, router);

  app.notFound((c) => c.json({ error: "not found" }, 404));
}
