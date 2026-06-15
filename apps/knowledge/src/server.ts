// Knowledge service entry — the harness's remote storage (chats + media now;
// KB/vectors later). Scans features, runs pending migrations, then serves.
//
//   GET    /health
//   POST   /auth/register | /auth/login | /auth/refresh → { accessToken, refreshToken, ... }
//   POST   /auth/logout                                 → 204
//   GET    /auth/sessions · DELETE /auth/sessions[/:id] → device management
//   GET    /data?prefix= · GET|PUT|DELETE /data/:key    → the Storage port

import { Hono } from "hono";
import { serve as honoServe } from "@hono/node-server";

import { config } from "./config/config.ts";
import { rootLogger } from "./core/logger.ts";
import { loadRegistry } from "./core/registry.ts";
import { runInitialMigration } from "./database/index.ts";
import { mountRoutes } from "./http/app.ts";

const log = rootLogger.child({ component: "server" });

const app = new Hono();

async function main(): Promise<void> {
  const scanned = await loadRegistry();
  mountRoutes(app, scanned);
  log.info({ routers: scanned.routers.length }, "features.scanned");

  if (config.database.url) {
    await runInitialMigration();
    log.info("db.migrated");
  } else {
    log.warn("DATABASE_URL unset — MariaDB is required; storage routes will fail until it is set");
  }

  honoServe({ fetch: app.fetch, port: config.api.port, hostname: "0.0.0.0" }, (info) => {
    log.info({ port: info.port }, "server.up");
    void registerWithInngest(info.port);
  });
}

// Inngest sync: PUT our own /inngest webhook so the inngest/hono handler pushes
// the registered function manifest to the inngest server. `inngest start`
// (production mode) doesn't auto-discover SDKs, so without this the dashboard
// stays empty and queued events never fire. Best-effort with a short retry.
async function registerWithInngest(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/inngest`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT" });
      if (res.ok) {
        log.info({ url }, "inngest.synced");
        return;
      }
      log.warn({ status: res.status, attempt }, "inngest.sync.retry");
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), attempt }, "inngest.sync.unreachable");
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  log.error({ url }, "inngest.sync.gave_up");
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, "server.boot.failed");
  process.exit(1);
});
