// The harness Storage port over HTTP: get/set/del by key + list-by-prefix,
// all scoped to the caller's user_id (from the access JWT).
//
//   GET    /data?prefix=<p>   → { keys: string[] }
//   GET    /data/:key         → { value } | 404
//   PUT    /data/:key         { value }  → 204
//   DELETE /data/:key         → 204
//
// Keys carry ':' separators (e.g. v84-harness:sessions:msgs:<sid>); the
// client URL-encodes them, Hono decodes the param.

import { Hono } from "hono";

import { openRepos } from "../../database/repos.ts";
import { requireAuth, type AuthEnv } from "../auth/middleware.ts";

export const dataRouter = new Hono<AuthEnv>();
dataRouter.use("*", requireAuth);

dataRouter.get("/", async (c) => {
  const keys = await openRepos().data.keys(c.get("userId"), c.req.query("prefix") ?? "");
  return c.json({ keys });
});

dataRouter.get("/:key", async (c) => {
  const value = await openRepos().data.get(c.get("userId"), c.req.param("key"));
  if (value === null) return c.json({ error: "not found" }, 404);
  return c.json({ value });
});

dataRouter.put("/:key", async (c) => {
  const { value } = await c.req.json<{ value?: string }>();
  if (typeof value !== "string") return c.json({ error: "value (string) required" }, 400);
  await openRepos().data.set(c.get("userId"), c.req.param("key"), value);
  return c.body(null, 204);
});

dataRouter.delete("/:key", async (c) => {
  await openRepos().data.del(c.get("userId"), c.req.param("key"));
  return c.body(null, 204);
});
