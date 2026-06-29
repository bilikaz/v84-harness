// The code-review graph — event-driven named nodes (implementation.md). Flow:
//   scope (pick files) → mode (split | several)
//     split    → how-many → split the files across N `review:general` heads
//     several  → pick which specialist reviewers → one head each, all files
//   → each reviewer → verify (re-examine) → goToAll → consolidate → present.
// Each node is a start/end pair. `start(input)` kicks off the work; `end(input, response)` has both the input
// it started with and the agent/modal response, and composes the next input — nothing reads another node.

import { BaseGraph } from "../../../core/graph/base.ts";
import type { FanMember, GraphNode, SelectAnswer, SelectOption } from "../../../core/graph/types.ts";
import { getConfig } from "../../../core/config/index.ts";
import i18n from "../../../lib/i18n.ts";
import { REVIEW_DEFAULTS, REVIEW_SLUG, type ReviewSettings } from "../manifest.ts";

const ROSTER = ["general", "logic", "security", "conventions", "performance"];
const FINDINGS = { required: ["findings"] };

type Resp = { ok: boolean; text: string };
type Scoped = { files: string[] };
type HeadIn = { role: string; files: string[] };
const sel = (r: unknown): string[] => (r as SelectAnswer | null)?.selected ?? [];

export default class ReviewGraph extends BaseGraph {
  getTitle(): string {
    return i18n.t("plugins.review.start");
  }
  needsWorkspace(): boolean {
    return true;
  }

  readonly entry = "scope";
  readonly nodes: Record<string, GraphNode> = {
    // Pick which FOLDERS to review, as a tree (selecting a folder cascades to its children). Built from an
    // ignore-aware scan of supported extensions; the picked folders expand to their files (seeded into reviewers).
    scope: {
      start: async (ctx) => {
        const s = reviewSettings();
        const files = await ctx.scan({ ignore: s.ignore, extensions: s.extensions });
        const tree = folderTree(files);
        const options: SelectOption[] = tree.length ? tree : [{ id: "/workspace", label: i18n.t("plugins.review.scopeAll") }];
        return { modal: { id: "scope", prompt: i18n.t("plugins.review.scopePrompt"), view: "tree", source: "user", multi: true, options } };
      },
      end: async (ctx, _input, response) => {
        const s = reviewSettings();
        const picked = sel(response);
        const all = await ctx.scan({ ignore: s.ignore, extensions: s.extensions });
        const files = !picked.length || picked.includes("/workspace") ? all : all.filter((f) => picked.some((d) => f === d || f.startsWith(`${d}/`)));
        return { goTo: "mode", input: { files } satisfies Scoped };
      },
    },

    // Split the files across N general reviewers, or run several specialists.
    mode: {
      start: () => ({
        modal: { id: "mode", prompt: i18n.t("plugins.review.modePrompt"), source: "user", options: [{ id: "split", label: i18n.t("plugins.review.modeSplit") }, { id: "several", label: i18n.t("plugins.review.modeSeveral") }] },
      }),
      end: (_ctx, input, response) => (sel(response)[0] === "split" ? { goTo: "splitCount", input } : { goTo: "pickReviewers", input }),
    },

    // split → how many slices.
    splitCount: {
      start: () => ({ modal: { id: "count", prompt: i18n.t("plugins.review.countPrompt"), source: "user", options: ["2", "3", "4"].map((n) => ({ id: n, label: n })) } }),
      end: (_ctx, input, response) => {
        const files = (input as Scoped).files;
        const n = clamp(Number(sel(response)[0] ?? "2"), 1, 8);
        const inputs: FanMember[] = partition(files, n).map((slice, i) => ({ name: `files-${i + 1}`, input: { role: "general", files: slice } satisfies HeadIn }));
        return { splitTo: "review", inputs };
      },
    },

    // several → pick which specialist reviewers run.
    pickReviewers: {
      start: () => ({ modal: { id: "reviewers", prompt: i18n.t("plugins.review.pickPrompt"), source: "user", multi: true, options: ROSTER.map((r) => ({ id: r, label: i18n.t(`plugins.review.reviewer.${r}`) })) } }),
      end: (_ctx, input, response) => {
        const files = (input as Scoped).files;
        const roles = sel(response).length ? sel(response) : ROSTER.slice(0, 3);
        const inputs: FanMember[] = roles.map((role) => ({ name: role, input: { role, files } satisfies HeadIn }));
        return { splitTo: "review", inputs };
      },
    },

    // A reviewer head — seeded with its files, returns strict findings JSON.
    review: {
      start: (_ctx, input) => {
        const it = input as HeadIn;
        return { agent: { agentId: `review:${it.role}`, task: reviewTask(it.files), schema: FINDINGS, seedFiles: it.files } };
      },
      end: (_ctx, input, response) => ({ goTo: "verify", input: { role: (input as HeadIn).role, findings: (response as Resp).text } }),
    },

    // A DEDICATED verifier (its own role, not the original reviewer) checks the findings, carrying the head's
    // group; then arrives at the consolidate join.
    verify: {
      start: (_ctx, input) => ({ agent: { agentId: "review:verifier", task: verifyTask((input as { findings: string }).findings), schema: FINDINGS } }),
      end: (_ctx, _input, response) => ({ goToAll: "consolidate", input: (response as Resp).text }),
    },

    // Fires once EVERY reviewer in the group has arrived; the consolidator merges/de-dups into one findings
    // set (same shape as reviewers), and the graph formats the final report deterministically.
    consolidate: {
      start: (_ctx, input) => ({ agent: { agentId: "review:consolidator", task: synthTask((input as string[]).join("\n\n")), schema: FINDINGS } }),
      end: (_ctx, _input, response) => ({ done: formatReport((response as Resp).text) }),
    },
  };
}

function reviewTask(files: string[]): string {
  return `Review these files: ${files.join(", ") || "the selected scope"}.\nRead them, then return your findings as the strict JSON object described in your instructions.`;
}
function verifyTask(findings: string): string {
  return `Findings to verify:\n\n${findings}\n\nVerify each per your instructions (confirm it's real, check it against the repo's conventions/docs, drop false positives) and return only the confirmed findings as the strict JSON object.`;
}
function synthTask(verified: string): string {
  return `Here are the verified findings from all reviewers:\n\n${verified}\n\nMerge, de-duplicate, group by file, and produce the report as the strict JSON object described in your instructions.`;
}

interface Finding {
  file?: string;
  line?: number;
  severity?: string;
  claim?: string;
  rationale?: string;
}
// Format the consolidator's merged findings into ONE clean report — deterministically, in the graph, so the
// presentation is consistent (not whatever markdown the model felt like emitting). Grouped by file, by severity.
function formatReport(text: string): string {
  let findings: Finding[] = [];
  try {
    const o = JSON.parse(text) as { findings?: Finding[] };
    if (Array.isArray(o.findings)) findings = o.findings;
  } catch {
    /* fall through to none */
  }
  if (!findings.length) return i18n.t("plugins.review.none");
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const file = f.file ?? "(unknown)";
    const arr = byFile.get(file) ?? [];
    arr.push(f);
    byFile.set(file, arr);
  }
  const out: string[] = [`**${findings.length} finding(s)**`];
  for (const file of [...byFile.keys()].sort()) {
    out.push("", `### ${file}`);
    const sorted = byFile.get(file)!.sort((a, b) => (rank[a.severity ?? "low"] ?? 3) - (rank[b.severity ?? "low"] ?? 3));
    for (const f of sorted) {
      const loc = f.line ? `:${f.line}` : "";
      out.push(`- **${(f.severity ?? "low").toUpperCase()}**${loc} — ${f.claim ?? ""}${f.rationale ? ` _(${f.rationale})_` : ""}`);
    }
  }
  return out.join("\n");
}
function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : lo;
}
function reviewSettings(): ReviewSettings {
  return (getConfig().plugins[REVIEW_SLUG]?.settings as ReviewSettings | undefined) ?? REVIEW_DEFAULTS;
}
// Build a nested folder tree (directories only) from the kept file paths — the scope picker.
function folderTree(files: string[]): SelectOption[] {
  const kids = new Map<string, Set<string>>();
  for (const f of files) {
    const parts = f.split("/"); // ["", "workspace", "src", …, "file.ts"]
    for (let i = 2; i < parts.length - 1; i++) {
      const parent = parts.slice(0, i).join("/");
      const child = parts.slice(0, i + 1).join("/");
      let set = kids.get(parent);
      if (!set) kids.set(parent, (set = new Set()));
      set.add(child);
    }
  }
  const build = (dir: string): SelectOption => ({ id: dir, label: dir.slice(dir.lastIndexOf("/") + 1) || dir, children: [...(kids.get(dir) ?? [])].sort().map(build) });
  return [...(kids.get("/workspace") ?? [])].sort().map(build);
}
// Round-robin the files into n slices, dropping any empty ones.
function partition<T>(arr: T[], n: number): T[][] {
  if (n <= 1) return [arr.slice()];
  const out: T[][] = Array.from({ length: n }, () => [] as T[]);
  arr.forEach((x, i) => out[i % n].push(x));
  return out.filter((s) => s.length);
}
