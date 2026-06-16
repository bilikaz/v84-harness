// messages HTTP surface — a session's transcript.
//
//   GET /messages?session=<sid>   → { messages }   (live)
//   PUT /messages  { sessionId, messages }  → 204   (replace the session's transcript)

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";
import type { Message } from "./repo.ts";

export const messagesRouter = new Hono<AuthEnv>();
messagesRouter.use("*", requireAuth);

messagesRouter.get("/", async (c) => {
  const sid = c.req.query("session") ?? "";
  return c.json({ messages: await openRepos().messages.listBySession(c.get("userId"), sid) });
});

messagesRouter.put("/", async (c) => {
  const b = await c.req.json<{ sessionId?: string; messages?: Message[] }>();
  if (!b.sessionId) return c.json({ error: "sessionId required" }, 400);
  await openRepos().messages.replaceForSession(c.get("userId"), b.sessionId, b.messages ?? []);
  return c.body(null, 204);
});
