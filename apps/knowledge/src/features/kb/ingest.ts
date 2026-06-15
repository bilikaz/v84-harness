// The ingest pipeline — durable + retried. Triggered by `kb/record.created`
// (the kb router, and later any data importer). Chunks + embeds the record's
// content and writes the nested chunk vectors. Fire-and-forget from the caller's
// side; Inngest owns the retries.

import { inngest } from "../../inngest/client.ts";
import { ingestRecord } from "./client.ts";

export const ingestFn = inngest.createFunction(
  { id: "kb-ingest", name: "Knowledgebase: chunk + embed a record", retries: 3, triggers: [{ event: "kb/record.created" }] },
  async ({ event }) => {
    await ingestRecord((event.data as { recordId: string }).recordId);
  },
);
