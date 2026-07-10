// The mascot flow — ONE creative dialog (the comics:mascot agent, in its OWN sub chat — the graph
// session stays clean with cards + results) + deterministic promotion (models create, graphs
// housekeep): the agent interviews, generates into SCRATCH (generated-images/ — generation can never
// touch curated folders), iterates to the USER's live approval (the user is the gate — every attempt
// was seen and judged), and gathers the character-bible details; the `save` node then verifies the
// approved path exists, promotes the image to avatars/, stamps the bible json, and writes the memory
// sheet ONCE — invariants live in code, never in prompt discipline. The bible file IS the
// registration: the avatars folder is the roster (files-as-ledger — no parallel registry to desync).

import { BaseGraph, EXIT } from "../../../core/graph/base.ts";
import type { GraphNode } from "../../../core/graph/types.ts";
import { getContainer } from "../../../core/containers.ts";
import { getSession } from "../../../core/sessions/store.ts";
import { getConfig } from "../../../core/config/index.ts";
import i18n from "../../../lib/i18n.ts";
import { COMICS_DEFAULTS, COMICS_SLUG, type ComicsSettings } from "../manifest.ts";
import { resolveAttempt } from "./util.ts";

// The character bible — avatars/<slug>.json. The graph stamps the skeleton; the comic flow's dialogs
// append `lore` (semantic, model-written) and the comic completion appends `stories` (deterministic).
export interface MascotBible {
  name: string;
  image: string;
  created: string;
  look: { description: string; style: string; proportions: string };
  character: { personality: string; charisma: string; emotions: string };
  lineage: string;
  stories: { date: string; title: string; summary: string; page: string }[];
  lore: { date: string; note: string }[];
}

interface Result {
  name: string;
  best: number; // the APPROVED attempt's number — the graph resolves it to a path (models never retype paths)
  path: string; // resolved by create.end via resolveAttempt
  description?: string;
  style?: string;
  proportions?: string;
  personality?: string;
  charisma?: string;
  emotions?: string;
  lineage?: string;
}
const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mascot";
const settings = (): ComicsSettings => (getConfig().plugins[COMICS_SLUG]?.settings as ComicsSettings | undefined) ?? COMICS_DEFAULTS;

export default class MascotGraph extends BaseGraph {
  getTitle(): string {
    return i18n.t("plugins.comics.mascotTitle");
  }
  needsWorkspace(): boolean {
    return true;
  }

  readonly entry = "create";
  readonly nodes: Record<string, GraphNode> = {
    // The whole creative loop, in its OWN sub chat (the comics:mascot agent — its system prompt carries
    // the method; the task carries only this run's specifics). The graph session stays clean: the node
    // card + the result JSON.
    create: {
      start: () => ({
        dialog: {
          agentId: "comics:mascot",
          // The sub chat's generations run under ITS session's avatar job (the `generationJob` meta key):
          // 1:1, silent attempt budget. The method + JSON contract live in the agent's system prompt —
          // the task is dynamics only.
          meta: { generationJob: { kind: "avatar", aspect: "1:1", quality: "super", max: settings().maxAvatarAttempts } },
          task: `Create a mascot with the user.`,
          schema: { required: ["name", "best"] },
        },
      }),
      end: async (ctx, _input, response) => {
        const r = JSON.parse(String(response)) as Result;
        const path = await resolveAttempt(ctx, Number(r.best));
        if (!path) ctx.break(i18n.t("plugins.comics.badBest", { best: String(r.best) }));
        return { goTo: "save", input: { ...r, path: path as string } };
      },
    },

    // Deterministic promotion: copy scratch → avatars/ → stamp the bible → register the row.
    save: {
      start: async (ctx, input) => {
        const r = input as Result;
        // One List of the parent dir — the approved path must exist before anything is stamped.
        const cut = r.path.lastIndexOf("/");
        const ls = await ctx.runTool("List", { path: r.path.slice(0, cut) });
        if (!ls?.ok || !ls.output.split("\n").some((l) => l.trim() === r.path.slice(cut + 1))) {
          ctx.break(i18n.t("plugins.comics.mascotMissing", { path: r.path }));
        }
        const safe = slug(r.name);
        const ext = r.path.slice(r.path.lastIndexOf(".")) || ".png";
        const dest = `/workspace/${settings().avatarsDir}/${safe}${ext}`;
        if (r.path !== dest) {
          // Copy, not move — the attempts stay in scratch as this job's history.
          const cp = await ctx.runTool("Copy", { from: r.path, to: dest });
          if (!cp?.ok) ctx.break(i18n.t("plugins.comics.promoteFailed", { error: cp?.output ?? "no tool gateway" }));
        }
        const bible: MascotBible = {
          name: r.name,
          image: dest,
          created: new Date().toISOString().slice(0, 10),
          look: { description: r.description ?? "", style: r.style ?? "", proportions: r.proportions ?? "" },
          character: { personality: r.personality ?? "", charisma: r.charisma ?? "", emotions: r.emotions ?? "" },
          lineage: r.lineage ?? "",
          stories: [],
          lore: [],
        };
        // Writing the bible IS the registration — the avatars folder is the roster.
        const wr = await ctx.runTool("Write", { path: `/workspace/${settings().avatarsDir}/${safe}.json`, content: JSON.stringify(bible, null, 2) });
        if (!wr?.ok) ctx.break(i18n.t("plugins.comics.promoteFailed", { error: wr?.output ?? "no tool gateway" }));
        // The SETTLED character sheet goes to memory ONCE, here — never by the agent mid-interview.
        // Best-effort: memory offline never blocks the promotion.
        const workspace = getContainer(getSession(ctx.sid)?.containerId)?.name;
        const sheet = [
          `Comic mascot "${r.name}"${workspace ? ` (workspace "${workspace}")` : ""} — image: ${dest}, bible: /workspace/${settings().avatarsDir}/${safe}.json`,
          bible.look.description && `Look: ${bible.look.description}`,
          bible.look.style && `Style: ${bible.look.style}`,
          bible.look.proportions && `Proportions: ${bible.look.proportions}`,
          bible.character.personality && `Personality: ${bible.character.personality}`,
          bible.character.charisma && `Charisma: ${bible.character.charisma}`,
          bible.character.emotions && `Emotions: ${bible.character.emotions}`,
          bible.lineage && `Lineage: ${bible.lineage}`,
        ]
          .filter(Boolean)
          .join("\n");
        await ctx.runTool("SaveMemory", { content: sheet, scope: "private", category: "comics-mascots" });
        // `show` makes the exit LOAD the promoted avatar into the chat — the result is seen.
        return { value: { ...bible, show: [dest] } };
      },
      end: (_ctx, _input, response) => ({ goTo: EXIT, input: response }),
    },
  };
}
