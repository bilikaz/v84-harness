// Inngest client — one shared instance. Functions register against it; the Hono
// webhook at /inngest serves them to the Inngest server (separate container in dev).
// Importers + the kb router emit events; the ingest function consumes them.

import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "knowledge" });
