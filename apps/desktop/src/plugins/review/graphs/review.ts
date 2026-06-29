// The code-review graph — event-driven named nodes (implementation.md). Flow:
//   scope (pick files) → mode (split | several)
//     split    → how-many → split the files across N `review:general` heads
//     several  → pick which specialist reviewers → one head each, all files
//   → each reviewer → verify (re-examine) → goToAll → consolidate → exit (final ```json output).
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
        const picked = sel(response);
        if (!picked.length) ctx.break(i18n.t("plugins.review.pickRequired"));
        const s = reviewSettings();
        const all = await ctx.scan({ ignore: s.ignore, extensions: s.extensions });
        const files = picked.includes("/workspace") ? all : all.filter((f) => picked.some((d) => f === d || f.startsWith(`${d}/`)));
        return { goTo: "mode", input: { files } satisfies Scoped };
      },
    },

    // Split the files across N general reviewers, or run several specialists.
    mode: {
      start: () => ({
        modal: { id: "mode", prompt: i18n.t("plugins.review.modePrompt"), source: "user", options: [{ id: "split", label: i18n.t("plugins.review.modeSplit") }, { id: "several", label: i18n.t("plugins.review.modeSeveral") }] },
      }),
      end: (ctx, input, response) => {
        const mode = sel(response)[0];
        if (!mode) ctx.break(i18n.t("plugins.review.pickRequired"));
        return mode === "split" ? { goTo: "splitCount", input } : { goTo: "pickReviewers", input };
      },
    },

    // split → how many slices.
    splitCount: {
      start: () => ({ modal: { id: "count", prompt: i18n.t("plugins.review.countPrompt"), source: "user", options: ["2", "3", "4"].map((n) => ({ id: n, label: n })) } }),
      end: (ctx, input, response) => {
        const picked = sel(response)[0];
        if (!picked) ctx.break(i18n.t("plugins.review.pickRequired"));
        const files = (input as Scoped).files;
        const n = clamp(Number(picked), 1, 8);
        const inputs: FanMember[] = partition(files, n).map((slice, i) => ({ name: `files-${i + 1}`, input: { role: "general", files: slice } satisfies HeadIn }));
        return { splitTo: "review", inputs };
      },
    },

    // several → pick which specialist reviewers run.
    pickReviewers: {
      start: () => ({ modal: { id: "reviewers", prompt: i18n.t("plugins.review.pickPrompt"), source: "user", multi: true, options: ROSTER.map((r) => ({ id: r, label: i18n.t(`plugins.review.reviewer.${r}`) })) } }),
      end: (ctx, input, response) => {
        const roles = sel(response);
        if (!roles.length) ctx.break(i18n.t("plugins.review.pickRequired"));
        const files = (input as Scoped).files;
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
    // set (same shape as reviewers). The consolidated JSON flows straight to the exit node, which renders it
    // as the final ```json block.
    consolidate: {
      start: (_ctx, input) => ({ agent: { agentId: "review:consolidator", task: synthTask((input as string[]).join("\n\n")), schema: FINDINGS } }),
      end: (_ctx, _input, response) => ({ goTo: "exit", input: (response as Resp).text }),
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
