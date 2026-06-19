import type { QueryResult } from "../../drivers/types.ts";

// Cap rows handed back to the model — large result sets bloat context and rarely help. The model is told
// to page with LIMIT/OFFSET when it needs more. (Output is also capped again by OUTPUT_CAP.)
const MAX_ROWS = 50;

export function formatResult(r: QueryResult): string {
  if (r.rows.length === 0) {
    return r.affectedRows !== undefined ? `OK — ${r.affectedRows} row(s) affected.` : "OK — 0 rows.";
  }
  const shown = r.rows.slice(0, MAX_ROWS);
  const head =
    r.rows.length > MAX_ROWS
      ? `${r.rows.length} row(s) (showing first ${MAX_ROWS} — add LIMIT/OFFSET to page through more):`
      : `${r.rows.length} row(s):`;
  return `${head}\n${shown.map((row) => JSON.stringify(row)).join("\n")}`;
}
