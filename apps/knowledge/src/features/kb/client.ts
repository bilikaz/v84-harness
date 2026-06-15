// Knowledgebase plane — entirely in OpenSearch. One doc per RECORD; its CHUNKS
// live NESTED inside it (so deleting the record drops its chunks, and a query
// returns the full record plus the matched chunk via inner_hits). Each record
// carries a `scope` (shared | private), its author `user_id`, and a `category`
// (shared corpus; permission-gating by category lands later).
//
// Ingestion is fire-and-forget: the record is indexed immediately (status
// "ingesting", no chunks); the Inngest pipeline chunks + embeds + writes the
// nested chunks (status "ready"). Search is hybrid — BM25 on the content + dense
// k-NN over the nested chunk vectors, in one pass.

import { config } from "../../config/config.ts";
import { rootLogger } from "../../core/logger.ts";
import { errorMessage, ServiceDownError } from "../../lib/errors.ts";

const log = rootLogger.child({ component: "kb" });
const INDEX = "memories";

export type Scope = "shared" | "private";
export type Status = "ingesting" | "ready" | "failed";

export interface Chunk {
  idx: number;
  content: string;
}

// Full record (GET /kb/:id) — content + all chunks.
export interface Record {
  id: string;
  scope: Scope;
  category: string | null;
  content: string;
  status: Status;
  createdAt: string;
  chunks: Chunk[];
}

// Search result — id + matched snippets + metadata, NO full content (fetch full via GET /kb/:id).
export interface SearchHit {
  id: string;
  score: number;
  scope: Scope;
  category: string | null;
  snippets: string[];
}

async function os(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(config.opensearch.url.replace(/\/$/, "") + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Connection refused / DNS — the index is unreachable, not a query error.
    throw new ServiceDownError("the knowledgebase (OpenSearch) is unavailable");
  }
}

let ensured: Promise<void> | null = null;
export function ensureIndex(): Promise<void> {
  ensured ??= (async () => {
    if ((await os("HEAD", `/${INDEX}`)).status === 200) return;
    const res = await os("PUT", `/${INDEX}`, {
      settings: { index: { knn: true } },
      mappings: {
        properties: {
          user_id: { type: "long" },
          scope: { type: "keyword" },
          category: { type: "keyword" },
          content: { type: "wildcard" }, // sparse side = AI-supplied regex; wildcard supports efficient regexp on long strings
          status: { type: "keyword" },
          created_at: { type: "date" },
          chunks: {
            type: "nested",
            properties: {
              idx: { type: "integer" },
              content: { type: "text" },
              embedding: {
                type: "knn_vector",
                dimension: config.embedding.dim,
                method: { name: "hnsw", engine: "lucene", space_type: "cosinesimil" },
              },
            },
          },
        },
      },
    });
    if (!res.ok && res.status !== 400) {
      ensured = null; // OpenSearch may still be booting — let the next call retry
      throw new Error(`kb index create failed: ${res.status} ${await res.text()}`);
    }
    log.info("kb.index.ready");
  })();
  return ensured;
}

async function embed(text: string, kind: "query" | "passage"): Promise<number[]> {
  const prefix = kind === "query" ? config.embedding.queryPrefix : config.embedding.passagePrefix;
  let res: Response;
  try {
    res = await fetch(config.embedding.baseUrl.replace(/\/$/, "") + "/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.embedding.model, input: prefix + text }),
    });
  } catch {
    throw new ServiceDownError("the embedding service (encoder) is unavailable");
  }
  if (!res.ok) throw new ServiceDownError(`the embedding service (encoder) returned ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const vec = data.data?.[0]?.embedding;
  if (!vec) throw new Error("embed response had no vector");
  return vec;
}

// Split into ~chunkChars windows with 10% overlap, breaking on whitespace near
// the boundary so chunks don't slice mid-word.
function chunkText(text: string): string[] {
  const t = text.trim();
  const size = config.embedding.chunkChars;
  if (t.length <= size) return t ? [t] : [];
  const overlap = Math.round(size * 0.1);
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + size, t.length);
    if (end < t.length) {
      const ws = t.lastIndexOf(" ", end);
      if (ws > i + size * 0.85) end = ws;
    }
    const piece = t.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    i = end - overlap;
  }
  return out;
}

// Index the record immediately (no chunks yet). The Inngest pipeline fills them.
export async function createRecord(userId: number, scope: Scope, content: string, category?: string): Promise<string> {
  await ensureIndex();
  const id = crypto.randomUUID();
  const res = await os("PUT", `/${INDEX}/_doc/${id}?refresh=wait_for`, {
    user_id: userId,
    scope,
    category: category ?? null,
    content,
    status: "ingesting" as Status,
    created_at: new Date().toISOString(),
    chunks: [],
  });
  if (!res.ok) throw new Error(`kb create record failed: ${res.status} ${await res.text()}`);
  return id;
}

// The ingest step: chunk + embed the record's content, write the nested chunks,
// flip status. Idempotent — re-running overwrites the chunks.
export async function ingestRecord(id: string): Promise<void> {
  await ensureIndex();
  const get = await os("GET", `/${INDEX}/_doc/${id}`);
  if (get.status === 404) throw new Error(`kb record ${id} not found`);
  const doc = (await get.json()) as { _source?: { content?: string } };
  const content = doc._source?.content ?? "";
  const pieces = chunkText(content);
  const embeddings = await Promise.all(pieces.map((p) => embed(p, "passage")));
  const chunks = pieces.map((content, idx) => ({ idx, content, embedding: embeddings[idx] }));
  const res = await os("POST", `/${INDEX}/_update/${id}?refresh=wait_for`, {
    doc: { chunks, status: "ready" as Status },
  });
  if (!res.ok) throw new Error(`kb ingest update failed: ${res.status} ${await res.text()}`);
  log.info({ id, chunks: chunks.length }, "kb.ingested");
}

// The AI supplies both legs: `sparse` is a regex (lexical), `dense` is natural
// language (embedded → semantic). Either or both.
export interface SearchInput {
  sparse?: string;
  dense?: string;
}

export interface SearchOpts {
  scope?: Scope;
  category?: string;
  k?: number;
}

function visibility(userId: number, opts: SearchOpts): unknown {
  const sharedMust: unknown[] = [{ term: { scope: "shared" } }];
  if (opts.category) sharedMust.push({ term: { category: opts.category } });
  const shared = { bool: { must: sharedMust } };
  const own = { bool: { must: [{ term: { scope: "private" } }, { term: { user_id: userId } }] } };
  if (opts.scope === "shared") return shared;
  if (opts.scope === "private") return own;
  return { bool: { should: [shared, own], minimum_should_match: 1 } };
}

// Hybrid: regex (sparse, on content) + dense k-NN over nested chunks, both
// visibility-filtered. The AI sends a regex and/or a natural-language string.
// (Scores aren't normalized across the two signals — a hybrid search pipeline can
// be layered on later; bool/should gives both signals for v1.)
export interface SearchResult {
  results: SearchHit[];
  // Set when the dense (semantic) leg was skipped because the encoder is down but
  // a regex leg still ran — partial results, surfaced so the agent can tell the user.
  note?: string;
}

export async function searchRecords(userId: number, input: SearchInput, opts: SearchOpts = {}): Promise<SearchResult> {
  await ensureIndex();
  const k = opts.k ?? 10;
  const should: unknown[] = [];
  if (input.sparse) should.push({ regexp: { content: { value: input.sparse, case_insensitive: true } } });
  let note: string | undefined;
  if (input.dense) {
    try {
      const vector = await embed(input.dense, "query");
      should.push({
        nested: {
          path: "chunks",
          query: { knn: { "chunks.embedding": { vector, k } } },
          score_mode: "max",
          inner_hits: { _source: ["chunks.idx", "chunks.content"], size: 3 },
        },
      });
    } catch (e) {
      // Encoder down: degrade to the regex leg if we have one, else surface the outage.
      if (!input.sparse) throw e;
      note = "Semantic (dense) search was unavailable — the embedding service is down; these are keyword (regex) matches only.";
      log.warn({ err: errorMessage(e) }, "kb.search.dense_skipped");
    }
  }
  if (should.length === 0) return { results: [] };
  const res = await os("POST", `/${INDEX}/_search`, {
    size: k,
    // snippets come from inner_hits; metadata from _source; full content stays out.
    _source: ["scope", "category"],
    query: { bool: { filter: visibility(userId, opts), should, minimum_should_match: 1 } },
  });
  if (!res.ok) throw new Error(`kb search failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    hits?: {
      hits?: Array<{
        _id: string;
        _score: number;
        _source: { scope: Scope; category: string | null };
        inner_hits?: { chunks?: { hits?: { hits?: Array<{ _source: { idx: number; content: string } }> } } };
      }>;
    };
  };
  const results = (body.hits?.hits ?? []).map((h) => ({
    id: h._id,
    score: h._score,
    scope: h._source.scope,
    category: h._source.category,
    snippets: (h.inner_hits?.chunks?.hits?.hits ?? []).map((c) => c._source.content),
  }));
  return { results, note };
}

// Full record by id — content + all chunks. Visible if shared, or the caller's own private.
export async function getRecord(userId: number, id: string): Promise<Record | null> {
  await ensureIndex();
  const res = await os("GET", `/${INDEX}/_doc/${id}?_source_excludes=chunks.embedding`);
  if (res.status === 404) return null;
  const doc = (await res.json()) as {
    _source?: { user_id: number; scope: Scope; category: string | null; content: string; status: Status; created_at: string; chunks?: Chunk[] };
  };
  const s = doc._source;
  if (!s) return null;
  if (s.scope === "private" && s.user_id !== userId) return null; // not visible
  return {
    id,
    scope: s.scope,
    category: s.category,
    content: s.content,
    status: s.status,
    createdAt: s.created_at,
    chunks: (s.chunks ?? []).map((c) => ({ idx: c.idx, content: c.content })),
  };
}

// Edit a record's content (own only) → reset to "ingesting"; the caller re-emits
// the ingest event so the chunks are rebuilt. Returns false if missing/not owned.
export async function updateRecord(userId: number, id: string, content: string): Promise<boolean> {
  await ensureIndex();
  const get = await os("GET", `/${INDEX}/_doc/${id}?_source_includes=user_id`);
  if (get.status === 404) return false;
  const doc = (await get.json()) as { _source?: { user_id?: number } };
  if (doc._source?.user_id !== userId) return false;
  const res = await os("POST", `/${INDEX}/_update/${id}?refresh=wait_for`, {
    doc: { content, status: "ingesting" as Status, chunks: [] },
  });
  return res.ok;
}

// Delete the record (its nested chunks go with it) — caller's own only.
export async function deleteRecord(userId: number, id: string): Promise<boolean> {
  await ensureIndex();
  const get = await os("GET", `/${INDEX}/_doc/${id}`);
  if (get.status === 404) return false;
  const doc = (await get.json()) as { _source?: { user_id?: number } };
  if (doc._source?.user_id !== userId) return false;
  await os("DELETE", `/${INDEX}/_doc/${id}?refresh=wait_for`);
  return true;
}
