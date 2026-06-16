// Device/session management (multi-device): list your sessions, revoke one,
// revoke all. Mounted under /auth/sessions; every route requires auth.
//
//   GET    /auth/sessions       → { sessions: [...] }  (current flagged)
//   DELETE /auth/sessions/:id   → 204  (revoke one device)
//   DELETE /auth/sessions       → 204  (revoke all — logout everywhere)

import { Hono } from "hono";

import { openRepos } from "../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../auth/middleware.ts";

export const sessionsRouter = new Hono<AuthEnv>();
sessionsRouter.use("*", requireAuth);

sessionsRouter.get("/", async (c) => {
  const current = c.get("sessionId");
  const rows = await openRepos().authSessions.listByUser(c.get("userId"));
  return c.json({
    sessions: rows.map((s) => ({
      id: s.id,
      deviceName: s.device_name,
      ip: s.ip_address,
      lastSeenAt: s.last_seen_at,
      createdAt: s.created_at,
      current: s.id === current,
    })),
  });
});

sessionsRouter.delete("/:id", async (c) => {
  await openRepos().authSessions.revoke(c.req.param("id"), c.get("userId"));
  return c.body(null, 204);
});

sessionsRouter.delete("/", async (c) => {
  await openRepos().authSessions.revokeAll(c.get("userId"));
  return c.body(null, 204);
});
