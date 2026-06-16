// plugins HTTP surface — CRUD scoped to user_id. DELETE soft-deletes.

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";
import type { PluginInput } from "./repo.ts";

export const pluginsRouter = new Hono<AuthEnv>();
pluginsRouter.use("*", requireAuth);

pluginsRouter.get("/", async (c) => {
  return c.json({ plugins: await openRepos().plugins.list(c.get("userId")) });
});

pluginsRouter.get("/:id", async (c) => {
  const row = await openRepos().plugins.get(c.get("userId"), c.req.param("id"));
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

pluginsRouter.put("/:id", async (c) => {
  const b = await c.req.json<Partial<PluginInput>>();
  await openRepos().plugins.put(c.get("userId"), {
    id: c.req.param("id"),
    name: String(b.name ?? ""),
    version: b.version ?? null,
    enabled: b.enabled !== false,
    config: b.config ?? {},
    permissions: b.permissions ?? {},
    placement: String(b.placement ?? "remote"),
  });
  return c.body(null, 204);
});

pluginsRouter.delete("/:id", async (c) => {
  await openRepos().plugins.softDelete(c.get("userId"), c.req.param("id"));
  return c.body(null, 204);
});
