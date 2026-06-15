// Knowledgebase routes — add a record (shared or private; chunked + embedded
// asynchronously by the ingest pipeline), search across the caller's visible set
// (shared ∪ own private) with a regex (sparse) and/or natural-language (dense)
// leg, delete own. Scoped by the access JWT's user_id.
//
//   POST   /kb            { content, scope: shared|private, category? } → 202 { id, status }
//   POST   /kb/search     { keywords?, phrase?, scope?, category?, k? } → { results: snippets + id }
//   GET    /kb/:id                                                       → full record | 404
//   PUT    /kb/:id        { content }                                    → 202 { id, status } (re-ingest) | 404
//   DELETE /kb/:id                                                       → 204 | 404

import { Hono } from "hono";

import { requireAuth, type AuthEnv } from "../auth/middleware.ts";
import { inngest } from "../../inngest/client.ts";
import { createRecord, deleteRecord, getRecord, searchRecords, updateRecord, type Scope } from "./client.ts";
import { errorMessage, ServiceDownError } from "../../lib/errors.ts";

const reingest = (recordId: string): Promise<unknown> => inngest.send({ name: "kb/record.created", data: { recordId } });

const isScope = (s: unknown): s is Scope => s === "shared" || s === "private";

export const kbRouter = new Hono<AuthEnv>();
kbRouter.use("*", requireAuth);

// A downed dependency (OpenSearch / the encoder) is a 503 the agent can relay to
// the user — not a generic 500. Everything else stays a 500.
kbRouter.onError((err, c) =>
  err instanceof ServiceDownError
    ? c.json({ error: errorMessage(err) }, 503)
    : c.json({ error: errorMessage(err) }, 500),
);

kbRouter.post("/", async (c) => {
  const { content, scope, category } = await c.req.json<{ content?: string; scope?: string; category?: string }>();
  if (!content || !isScope(scope)) return c.json({ error: "content + scope (shared|private) required" }, 400);
  const id = await createRecord(c.get("userId"), scope, content, category);
  // Fire-and-forget: the pipeline chunks + embeds; the client just gets the id.
  await reingest(id);
  return c.json({ id, status: "ingesting" }, 202);
});

kbRouter.post("/search", async (c) => {
  const { keywords, phrase, scope, category, k } = await c.req.json<{
    keywords?: string;
    phrase?: string;
    scope?: string;
    category?: string;
    k?: number;
  }>();
  if (!keywords?.trim() && !phrase?.trim()) return c.json({ error: "keywords and/or phrase required" }, 400);
  const { results, note } = await searchRecords(
    c.get("userId"),
    { keywords, phrase },
    { scope: isScope(scope) ? scope : undefined, category, k: typeof k === "number" ? k : undefined },
  );
  return c.json({ results, note });
});

kbRouter.get("/:id", async (c) => {
  const record = await getRecord(c.get("userId"), c.req.param("id"));
  return record ? c.json(record) : c.json({ error: "not found" }, 404);
});

kbRouter.put("/:id", async (c) => {
  const { content } = await c.req.json<{ content?: string }>();
  if (!content) return c.json({ error: "content required" }, 400);
  const ok = await updateRecord(c.get("userId"), c.req.param("id"), content);
  if (!ok) return c.json({ error: "not found" }, 404);
  await reingest(c.req.param("id")); // rebuild chunks from the new content
  return c.json({ id: c.req.param("id"), status: "ingesting" }, 202);
});

kbRouter.delete("/:id", async (c) => {
  const ok = await deleteRecord(c.get("userId"), c.req.param("id"));
  return ok ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});
