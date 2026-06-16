// media HTTP surface — blobs per session.
//
//   GET    /media?session=<sid>  → { media }   (live)
//   PUT    /media/:id            → 204 (upsert)
//   DELETE /media/:id            → 204 (soft delete)

import { Hono } from "hono";

import { openRepos } from "../../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../../auth/middleware.ts";
import type { Media } from "./repo.ts";

export const mediaRouter = new Hono<AuthEnv>();
mediaRouter.use("*", requireAuth);

mediaRouter.get("/", async (c) => {
  const sid = c.req.query("session") ?? "";
  return c.json({ media: await openRepos().media.listBySession(c.get("userId"), sid) });
});

mediaRouter.put("/:id", async (c) => {
  const b = await c.req.json<Partial<Media>>();
  await openRepos().media.put(c.get("userId"), {
    id: c.req.param("id"),
    sessionId: String(b.sessionId ?? ""),
    messageId: String(b.messageId ?? ""),
    kind: String(b.kind ?? "file"),
    mime: String(b.mime ?? ""),
    name: b.name ?? null,
    data: String(b.data ?? ""),
  });
  return c.body(null, 204);
});

mediaRouter.delete("/:id", async (c) => {
  await openRepos().media.softDelete(c.get("userId"), c.req.param("id"));
  return c.body(null, 204);
});
