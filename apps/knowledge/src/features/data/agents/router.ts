// agents HTTP surface — CRUD scoped to user_id. DELETE soft-deletes.

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";
import type { AgentInput } from "./repo.ts";

export const agentsRouter = new Hono<AuthEnv>();
agentsRouter.use("*", requireAuth);

agentsRouter.get("/", async (c) => {
  return c.json({ agents: await openRepos().agents.list(c.get("userId")) });
});

agentsRouter.get("/:id", async (c) => {
  const row = await openRepos().agents.get(c.get("userId"), c.req.param("id"));
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

agentsRouter.put("/:id", async (c) => {
  const b = await c.req.json<Partial<AgentInput>>();
  await openRepos().agents.put(c.get("userId"), {
    id: c.req.param("id"),
    name: String(b.name ?? ""),
    description: b.description ?? null,
    system: b.system ?? null,
    user: b.user ?? null,
    workspace: !!b.workspace,
    tools: b.tools ?? {},
  });
  return c.body(null, 204);
});

agentsRouter.delete("/:id", async (c) => {
  await openRepos().agents.softDelete(c.get("userId"), c.req.param("id"));
  return c.body(null, 204);
});
