// Wires routes onto the given Hono app: cross-cutting middleware + the
// boot-scanned feature routers. Add a feature's register.ts and it mounts here
// automatically (see core/registry.ts).

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve as inngestServe } from "inngest/hono";

import { inngest } from "../inngest/client.ts";
import type { RegistryState } from "../core/feature.ts";

export function mountRoutes(app: Hono, scanned: RegistryState): void {
  // CORS — the harness renderer calls this from a different origin. Echo any
  // origin back; tighten once deployment origins are fixed.
  app.use(
    "/*",
    cors({
      origin: (origin) => origin ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Device-Name"],
      credentials: true,
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
