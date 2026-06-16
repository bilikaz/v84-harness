// plugin_data HTTP surface — a plugin's namespaced rows.
//
//   GET    /plugin-data?plugin=<id>&collection=<c>        → { rows }
//   PUT    /plugin-data  { pluginId, collection, key, value }  → 204 (upsert)
//   DELETE /plugin-data?plugin=<id>&collection=<c>&key=<k>     → 204 (soft delete)

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";
import type { PluginDataRow } from "./repo.ts";

export const pluginDataRouter = new Hono<AuthEnv>();
pluginDataRouter.use("*", requireAuth);

pluginDataRouter.get("/", async (c) => {
  const rows = await openRepos().pluginData.list(c.get("userId"), c.req.query("plugin") ?? "", c.req.query("collection") ?? "");
  return c.json({ rows });
});

pluginDataRouter.put("/", async (c) => {
  const b = await c.req.json<Partial<PluginDataRow>>();
  if (!b.pluginId || !b.collection || !b.key) return c.json({ error: "pluginId, collection, key required" }, 400);
  await openRepos().pluginData.put(c.get("userId"), { pluginId: b.pluginId, collection: b.collection, key: b.key, value: b.value ?? null });
  return c.body(null, 204);
});

pluginDataRouter.delete("/", async (c) => {
  await openRepos().pluginData.softDelete(c.get("userId"), c.req.query("plugin") ?? "", c.req.query("collection") ?? "", c.req.query("key") ?? "");
  return c.body(null, 204);
});
