// settings HTTP surface — key/value per user.
//
//   GET    /settings        → { settings }   (live)
//   PUT    /settings/:key   { scope, value } → 204 (upsert)
//   DELETE /settings/:key   → 204 (soft delete)

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";

export const settingsRouter = new Hono<AuthEnv>();
settingsRouter.use("*", requireAuth);

settingsRouter.get("/", async (c) => {
  return c.json({ settings: await openRepos().settings.list(c.get("userId")) });
});

settingsRouter.get("/:key", async (c) => {
  const row = await openRepos().settings.get(c.get("userId"), c.req.param("key"));
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

settingsRouter.put("/:key", async (c) => {
  const b = await c.req.json<{ scope?: string; value?: unknown }>();
  await openRepos().settings.put(c.get("userId"), {
    key: c.req.param("key"),
    scope: String(b.scope ?? "account"),
    value: b.value ?? null,
  });
  return c.body(null, 204);
});

settingsRouter.delete("/:key", async (c) => {
  await openRepos().settings.softDelete(c.get("userId"), c.req.param("key"));
  return c.body(null, 204);
});
