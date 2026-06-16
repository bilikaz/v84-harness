// containers HTTP surface — CRUD scoped to the caller's user_id (from the access JWT).
// DELETE soft-deletes server-side; the client treats it as gone.
//
//   GET    /containers        → { containers: Container[] }   (live only)
//   GET    /containers/:id    → Container | 404
//   PUT    /containers/:id    { ...container }  → 204          (upsert)
//   DELETE /containers/:id    → 204                            (soft delete)

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";
import type { ContainerInput } from "./repo.ts";

export const containersRouter = new Hono<AuthEnv>();
containersRouter.use("*", requireAuth);

containersRouter.get("/", async (c) => {
  return c.json({ containers: await openRepos().containers.list(c.get("userId")) });
});

containersRouter.get("/:id", async (c) => {
  const row = await openRepos().containers.get(c.get("userId"), c.req.param("id"));
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

containersRouter.put("/:id", async (c) => {
  const body = await c.req.json<Partial<ContainerInput>>();
  await openRepos().containers.put(c.get("userId"), {
    id: c.req.param("id"),
    type: String(body.type ?? "chat"),
    name: String(body.name ?? ""),
    permissions: body.permissions ?? {},
    config: body.config ?? {},
    placement: String(body.placement ?? "remote"),
  });
  return c.body(null, 204);
});

containersRouter.delete("/:id", async (c) => {
  await openRepos().containers.softDelete(c.get("userId"), c.req.param("id"));
  return c.body(null, 204);
});
