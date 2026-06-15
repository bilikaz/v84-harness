// Single source of config, read from the environment at boot. Mirrors the
// task-builder api's config surface (api/database/log/runtime) plus the auth
// knobs, without the yaml + override machinery this service doesn't need yet.

function num(v: string | undefined, fallback: number): number {
  const n = v != null && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const isDev = process.env.NODE_ENV !== "production";

export const config = {
  api: { port: num(process.env.API_PORT, 3000) },
  database: { url: process.env.DATABASE_URL ?? "" },
  log: { level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info") },
  runtime: { isDev },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-change-me",
    accessTtl: num(process.env.ACCESS_TTL, 900), // access token lifetime, seconds (15 min)
    refreshTtl: num(process.env.REFRESH_TTL, 60 * 60 * 24 * 30), // refresh/session lifetime, seconds (30 days)
  },
  // Knowledgebase: OpenSearch (vector index) + an OpenAI-compatible embedding
  // server. Model/dim/prefixes are docker config; dim is baked into the index.
  opensearch: { url: process.env.OPENSEARCH_URL ?? "" },
  embedding: {
    baseUrl: process.env.EMBEDDING_BASE_URL ?? "", // OpenAI-compatible; we POST `${baseUrl}/embeddings`
    model: process.env.EMBEDDING_MODEL ?? "intfloat/multilingual-e5-small",
    dim: num(process.env.EMBED_DIM, 384),
    // e5-family needs these; blank them (EMBED_*_PREFIX=) for BGE-M3 et al.
    queryPrefix: process.env.EMBED_QUERY_PREFIX ?? "query: ",
    passagePrefix: process.env.EMBED_PASSAGE_PREFIX ?? "passage: ",
    // A record is split into chunks of ~this many chars with 10% overlap; each
    // chunk is its own vector. Keep under the model's input limit.
    chunkChars: num(process.env.EMBED_CHUNK_CHARS, 2000),
  },
};
