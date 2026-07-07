// chat sessions HTTP surface — CRUD scoped to user_id. DELETE soft-deletes.
//
//   GET    /sessions       → { sessions }   (live only)
//   GET    /sessions/:id   → ChatSession | 404
//   PUT    /sessions/:id   → 204 (upsert)
//   DELETE /sessions/:id   → 204 (soft delete)

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";
import type { ChatSessionInput } from "./repo.ts";

export const sessionsRouter = new Hono<AuthEnv>();
sessionsRouter.use("*", requireAuth);

sessionsRouter.get("/", async (c) => {
  return c.json({ sessions: await openRepos().sessions.list(c.get("userId")) });
});

sessionsRouter.get("/:id", async (c) => {
  const row = await openRepos().sessions.get(c.get("userId"), c.req.param("id"));
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

sessionsRouter.put("/:id", async (c) => {
  const b = await c.req.json<Partial<ChatSessionInput>>();
  await openRepos().sessions.put(c.get("userId"), {
    id: c.req.param("id"),
    containerId: String(b.containerId ?? ""),
    parentId: b.parentId ?? null,
    agentId: b.agentId ?? null,
    graphId: b.graphId ?? null,
    title: String(b.title ?? ""),
    system: b.system ?? null,
    tools: b.tools ?? [],
    meta: b.meta ?? null, // the client's session.meta runtime bag, stored whole
  });
  return c.body(null, 204);
});

sessionsRouter.delete("/:id", async (c) => {
  await openRepos().sessions.softDelete(c.get("userId"), c.req.param("id"));
  return c.body(null, 204);
});
