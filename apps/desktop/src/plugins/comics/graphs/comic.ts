// The comic flow (implementation.md — models create, graphs housekeep):
//   plan (ONE dialog — the comics:plan agent in its own sub chat: story co-written, layout browsed via
//   GalleryOptions and decided together, scenes/dialogue/reuse/characters planned, pasted references
//   recorded per panel, validation mode + comic name chosen → the full CONFIG json)
//   → setup (secured folder comics/<name>/ — collision takes the next free suffix deterministically;
//     pasted img-N references materialized as comics/<name>/refs/ files — aliases die with the
//     session, files are the comic's)
//   → per frame: a FRESH generating head (PanelGenerate under a session job — silent attempt budget,
//     choose-best convergence) → an INDEPENDENT checker head validates the candidate (lettering, on-model,
//     reuse, style; capped refire loop) → graph secures the approved attempt as comics/<name>/panel<i>.png
//     (+ optional per-frame user review when the user opted in)
//   → compose (direct GalleryCompose call → comics/<name>/page.png)
//   → finish (story records + settled lore appended to every cast bible) → exit.
//   Every panel was already validated (checker gate + optional per-frame review) — no final gate;
//   a targeted redo stays available via a `frame {json}` node jump.
// The imageRec gate stays: frame and checker heads work with vision.

import { BaseGraph, EXIT } from "../../../core/graph/base.ts";
import type { GraphNode, NodeCtx, Route } from "../../../core/graph/types.ts";
import { getConfig } from "../../../core/config/index.ts";
import { getContainer } from "../../../core/containers.ts";
import { resolveMain, resolveMediaProvider } from "../../../core/settings.ts";
import { extractRefTokens, isMediaRef } from "../../../core/sessions/mediaRefs.ts";
import { getSession } from "../../../core/sessions/store.ts";
import { supportedCounts, findLayout, type GalleryLayout } from "../../../core/gallery/catalog.ts";
import i18n from "../../../lib/i18n.ts";
import { COMICS_DEFAULTS, COMICS_SLUG, type ComicsSettings } from "../manifest.ts";
import { resolveAttempt } from "./util.ts";

interface Dialogue {
  speaker: string;
  text: string;
}
interface Uses {
  avatars?: string[];
  frames?: number[];
  images?: string[]; // pasted references — img-N aliases in the plan, refs/ paths after setup materializes
  notes?: string;
}
interface Panel {
  scene: string;
  dialogue?: Dialogue[];
  caption?: string | null;
  uses?: Uses;
}
interface Config {
  title: string;
  name: string; // the comic's folder name (comics/<name>/)
  layoutId: string; // a layout handle ("5-3") or id
  userValidation: boolean; // review each frame, or autonomous until the final review
  synopsis: string;
  date?: string; // masthead top-right line 1 — a date / issue tag, agreed at plan time
  credit?: string; // masthead top-right line 2 — author / copyright, agreed at plan time
  cast: string[];
  panels: Panel[];
  // Character changes the approved story implies (new gear, a scar, growth) — recorded in the plan,
  // STAMPED by the graph at finish (bible `lore` + memory). The agent never edits files or memory.
  lore?: { mascot: string; note: string }[];
}
// SELF-DESCRIBING run state: `panel` is the panel being worked (1-based) and `completed` maps
// secured panel numbers to their images — so any step can be FIRED with the state in hand
// (`frame {..., "panel": 2, "completed": {...}}` regenerates one panel), and advance() derives
// what's next from `completed` instead of a blind cursor: regenerating panel 2 with 1/3/4 done
// goes straight to compose after securing.
interface Flow {
  cfg: Config;
  layout: GalleryLayout;
  cast: Record<string, string>; // mascot name → avatar image path
  panel: number; // the panel being worked, 1-based
  completed: Record<number, string>; // secured panels: number → comics/<name>/panelN.png
  pending?: string; // the frame head's chosen attempt, awaiting the checker's verdict
  refires?: number; // checker-rejection refires of the current frame (capped)
  feedback?: string; // rejection feedback for a refire of the current frame
  rejected?: string; // the rejected attempt's path — becomes a "rejected" reference row in the refire task
  rejectedBy?: "check" | "review"; // who rejected — only CHECKER verdicts are contestable (the user is the gate)
  contest?: string; // the generator's argument RESUBMITTING the rejected candidate — the checker re-examines
  page?: string;
}

// The lowest not-yet-secured panel, or null when the page is complete.
function nextMissing(f: Flow): number | null {
  for (let n = 1; n <= f.cfg.panels.length; n++) if (!f.completed[n]) return n;
  return null;
}

// Checker rejections refire the frame at most this many times; past it the best candidate is secured
// anyway and the user's per-frame review (when enabled) arbitrates — a disagreeing pair never loops.
const MAX_REFIRES = 3;

const settings = (): ComicsSettings => (getConfig().plugins[COMICS_SLUG]?.settings as ComicsSettings | undefined) ?? COMICS_DEFAULTS;
// Read-tool output → raw content (drop the header line + "  N: " numbering).
const stripRead = (out: string): string => out.split("\n").slice(1).map((l) => l.replace(/^\s*\d+: /, "")).join("\n");
const biblePath = (imagePath: string): string => imagePath.replace(/\.[a-z0-9]+$/i, ".json");

// A registered mascot — parsed straight from its bible file.
interface Mascot {
  name: string;
  image: string;
  bible: string; // the bible json text, as task context for the planner and frame heads
}

// The ROSTER is the avatars FOLDER — the bible files ARE the registration (files-as-ledger,
// ADR-0082). A mascot copied into the workspace by hand is as real as a flow-made one, and it is
// workspace-scoped by construction (the old pluginData rows were global, so one workspace's
// mascots leaked into another's roster pointing at files that don't exist there).
async function readRoster(ctx: NodeCtx): Promise<Mascot[]> {
  const dir = `/workspace/${settings().avatarsDir}`;
  const ls = await ctx.runTool("List", { path: dir });
  if (!ls?.ok) return [];
  const out: Mascot[] = [];
  for (const line of ls.output.split("\n").slice(1)) {
    const entry = line.trim();
    if (!entry.endsWith(".json")) continue;
    const read = await ctx.runTool("Read", { path: `${dir}/${entry}` });
    if (!read?.ok) continue;
    const text = stripRead(read.output);
    try {
      const b = JSON.parse(text) as { name?: string; image?: string };
      if (b.name && b.image) out.push({ name: b.name, image: b.image, bible: text });
    } catch {
      // not a bible — a stray json in the folder is ignored, never fatal
    }
  }
  return out;
}
const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "comic";
const refsDir = (f: Flow): string => `/workspace/${settings().comicsDir}/${slug(f.cfg.name)}/refs`;

// After a panel is secured: the LOWEST missing panel next (derived from `completed`, never a blind
// cursor — a targeted regeneration proceeds to compose when everything else is already done), or
// compose when the page is complete.
function advance(f: Flow): Route {
  const next = nextMissing(f);
  if (next !== null) return { goTo: "frame", input: { ...f, panel: next } satisfies Flow };
  return { goTo: "compose", input: f };
}

// Validate/clamp the plan's reference declarations: frames point BACKWARD only, avatars must be cast,
// images are img-N aliases or workspace paths, ≤6 declared per panel (past 4 the frame head generates
// in STAGES; frames trimmed oldest-first, then avatars — pasted images are explicit user intent and go
// last). NO default previous-frame anchor: every face in a reference is a face candidate to an image
// model, so an undeclared past panel BLEEDS its characters into this one (and misleads the checker the
// same way) — an unanchored panel falls back to its cast avatars instead (panelRefs).
function clampUses(cfg: Config): Config {
  const cast = new Set(cfg.cast);
  cfg.panels.forEach((p, i) => {
    const u = (p.uses ??= {});
    u.avatars = (u.avatars ?? []).filter((a) => cast.has(a));
    u.frames = (u.frames ?? []).filter((f) => Number.isInteger(f) && f >= 1 && f <= i);
    u.images = (u.images ?? []).filter((s) => typeof s === "string" && ((isMediaRef(s) && s.startsWith("img-")) || s.startsWith("/workspace/")));
    while (u.avatars.length + u.frames.length + u.images.length > 6) {
      if (u.frames.length > 1) u.frames.shift();
      else if (u.avatars.length) u.avatars.pop();
      else if (u.frames.length) u.frames.shift();
      else u.images.pop();
    }
  });
  cfg.lore = (cfg.lore ?? []).filter((l) => l && typeof l.mascot === "string" && typeof l.note === "string" && cast.has(l.mascot));
  return cfg;
}

interface PanelRef {
  alias: string;
  path: string;
  desc: string;
}

// The panel's reference images with ready aliases/descriptions, most important first — what the frame
// head passes to PanelGenerate and the checker compares against. Falls back to the cast avatars as
// style anchors so a panel is never unanchored (PanelGenerate refuses an empty list). Aliases deduped
// so the tool's uniqueness rule always passes.
function panelRefs(f: Flow): PanelRef[] {
  const p = f.cfg.panels[f.panel - 1];
  const out: PanelRef[] = [];
  for (const a of p.uses?.avatars ?? []) if (f.cast[a]) out.push({ alias: slug(a), path: f.cast[a], desc: `avatar of the mascot ${a} — the ground truth for how ${a} looks` });
  for (const n of p.uses?.frames ?? []) {
    if (!f.completed[n]) continue;
    // Purpose-scoped: an earlier panel is SETTING/ELEMENT reuse only — its people must never bleed
    // into this panel (nor mislead the checker about who this panel's characters are).
    const src = f.cfg.panels[n - 1]?.uses?.avatars ?? [];
    const what = p.uses?.notes ? `ONLY what the reuse note names ("${p.uses.notes}")` : "ONLY its setting/style";
    const who = src.length ? `the people in it are ${src.join(", ")} — ` : "";
    out.push({ alias: `panel${n}`, path: f.completed[n], desc: `earlier panel ${n} of this comic — reuse ${what}; ${who}NOT this panel's characters, never copy a face from it` });
  }
  (p.uses?.images ?? []).forEach((img, k) => {
    if (img.startsWith("/workspace/")) out.push({ alias: `ref${k + 1}`, path: img, desc: "content reference provided in the plan — ground truth for the place/object/style it shows" });
  });
  if (!out.length) for (const [name, path] of Object.entries(f.cast)) out.push({ alias: slug(name), path, desc: `avatar of ${name} (style anchor)` });
  const used = new Set<string>();
  for (const r of out) {
    let alias = r.alias || "ref";
    for (let i = 2; used.has(alias); i++) alias = `${r.alias}${i}`;
    used.add(alias);
    r.alias = alias;
  }
  return out;
}

// Feedback may mention pasted images by alias — materialize each into the comic's refs/ folder and swap
// the mention to the file path, so the refired (cross-session) head can actually use it.
async function materializeFeedback(ctx: NodeCtx, f: Flow, text: string): Promise<string> {
  let out = text;
  for (const token of extractRefTokens(text)) {
    if (!token.startsWith("img-")) continue;
    const dest = `${refsDir(f)}/${token}.png`;
    const cp = await ctx.runTool("Copy", { from: token, to: dest });
    if (cp?.ok) out = out.split(token).join(dest);
  }
  return out;
}

// This panel's cast line — who IS in the panel (registered mascots) — so neither the generator nor
// the checker infers characters from reference images (an earlier panel's face is NOT this panel's).
function castLine(f: Flow): string {
  const names = (f.cfg.panels[f.panel - 1].uses?.avatars ?? []).filter((a) => f.cast[a]);
  return names.length
    ? `CHARACTERS IN THIS PANEL: ${names.join(", ")} — their avatars are the ground truth for how they look. Anyone visible in an "earlier panel" reference is NOT in this panel unless the scene names them.`
    : `CHARACTERS IN THIS PANEL: no registered mascots — only who the scene describes. Anyone visible in an "earlier panel" reference is NOT in this panel unless the scene names them.`;
}

// The frame head's task — sectioned, one fact per line (dense run-on prose makes small models wander:
// they browse folders instead of loading the listed files, and miss facts buried mid-sentence). The
// method and JSON contract live in the agent's system prompt; this is the dynamic spec.
function frameTask(f: Flow, bibles: string[]): string {
  const p = f.cfg.panels[f.panel - 1];
  const slot = f.layout.slots[f.panel - 1];
  const refs = panelRefs(f);
  const bubbles = (p.dialogue ?? []).map((d) => `${d.speaker}: "${d.text}"`).join("; ");
  const cut = !!(slot.cell || slot.clip || slot.rot);
  return [
    `Generate panel ${f.panel}/${f.cfg.panels.length} of the comic "${f.cfg.title}".`,
    "",
    castLine(f),
    "",
    `SCENE: ${p.scene}`,
    bubbles ? `BUBBLES (letter EXACTLY): ${bubbles}` : `BUBBLES: none — no lettering in this panel.`,
    p.caption ? `CAPTION BOX: "${p.caption}"` : "",
    p.uses?.notes ? `REUSE: ${p.uses.notes}` : "",
    "",
    f.feedback ? `FIX THIS — the previous version was rejected:\n${f.feedback}\n` : "",
    refs.length
      ? `REFERENCES (already loaded above, in this order — pass ALL of them to PanelGenerate, most important first; these files and your attempts are the ONLY files you touch, do not browse folders):\n${refs.map((r) => `"${r.alias}" — ${r.path}: ${r.desc}`).join("\n")}`
      : "",
    f.rejected ? `"rejected" — ${f.rejected}: your REJECTED previous attempt — pass it as one more reference only to see what to fix, never to copy.` : "",
    refs.length > 4 ? `More than 4 references — generate in STAGES: the core subjects first, then your best attempt as the base plus the rest.` : "",
    bibles.length ? `\nCHARACTER BIBLES:\n${bibles.join("\n---\n")}` : "",
    cut ? `\nSAFE AREA: the page layout trims this panel's edges — keep bubbles and key subjects at least 15% away from every edge. The BACKGROUND should still fill the whole canvas (full bleed) — only the important content stays inside.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// The checker head's task — the same sectioned spec the frame worked from, plus the candidate (the
// checklist and JSON contract live in the agent's system prompt).
function checkTask(f: Flow): string {
  const p = f.cfg.panels[f.panel - 1];
  const slot = f.layout.slots[f.panel - 1];
  const refs = panelRefs(f);
  const bubbles = (p.dialogue ?? []).map((d) => `${d.speaker}: "${d.text}"`).join("; ");
  const cut = !!(slot.cell || slot.clip || slot.rot);
  return [
    `Validate the candidate for panel ${f.panel}/${f.cfg.panels.length} of the comic "${f.cfg.title}".`,
    "",
    `CANDIDATE: ${f.pending}`,
    castLine(f),
    f.contest
      ? `\nCONTESTED: this candidate was rejected before, and the generator DISPUTES that rejection: "${f.contest}"\nRe-examine exactly those points with fresh eyes — uphold the rejection only if the image really shows the claimed defects.`
      : "",
    "",
    `SCENE: ${p.scene}`,
    bubbles ? `BUBBLES (must be lettered EXACTLY): ${bubbles}` : `BUBBLES: none — any stray lettering is a rejection.`,
    p.caption ? `CAPTION BOX: "${p.caption}"` : "",
    p.uses?.notes ? `REUSE: ${p.uses.notes}` : "",
    "",
    refs.length
      ? `REFERENCES (already loaded above, in this order — the candidate and these are the ONLY files you touch, do not browse folders):\n${refs.map((r) => `"${r.alias}" — ${r.path}: ${r.desc}`).join("\n")}`
      : "",
    cut ? `\nSAFE AREA: the page layout trims this panel's edges — BUBBLES or KEY SUBJECTS within ~15% of an edge are a rejection. Background/scenery reaching the edges is CORRECT (full bleed), never a violation.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export default class ComicGraph extends BaseGraph {
  getTitle(): string {
    return i18n.t("plugins.comics.comicTitle");
  }
  needsWorkspace(): boolean {
    return true;
  }

  readonly entry = "plan";
  readonly nodes: Record<string, GraphNode> = {
    // ONE planning dialog: everything decided together, then the complete config JSON.
    plan: {
      start: async (ctx) => {
        // The checker needs EYES: a vision-capable main model (sees panels via ImageLoad) or a
        // dedicated Image recognition assignment (ImageDescribe). Either satisfies the gate.
        if (!resolveMain()?.input?.image && !resolveMediaProvider("imageRec")) {
          ctx.break(i18n.t("plugins.comics.needVision"));
        }
        const roster = await readRoster(ctx);
        const castBlock = roster.map((m) => m.bible).join("\n---\n") || "(no mascots yet — invent characters)";
        // The method + JSON contract live in the comics:plan agent's system prompt — the task is
        // this run's DATA: the cast bibles.
        return {
          dialog: {
            agentId: "comics:plan",
            task: `Plan a comic with the user.\nThe mascot cast — full character bibles:\n${castBlock}`,
            schema: { required: ["title", "name", "layoutId", "userValidation", "panels", "cast"] },
          },
        };
      },
      end: async (ctx, _input, response) => {
        const cfg = clampUses(JSON.parse(String(response)) as Config);
        const layout = findLayout(cfg.layoutId);
        if (!layout) return ctx.break(i18n.t("plugins.comics.badLayout", { id: cfg.layoutId, counts: supportedCounts().join("/") }));
        if (cfg.panels.length !== layout.count) {
          ctx.break(i18n.t("plugins.comics.countMismatch", { panels: cfg.panels.length, layout: layout.handle, count: layout.count }));
        }
        const first = cfg.panels[0]?.uses;
        if (!first?.avatars?.length && !first?.images?.length) {
          ctx.break(i18n.t("plugins.comics.noAnchor"));
        }
        const roster = await readRoster(ctx);
        // Cast names must EXIST — an exact-match miss ("Vytas" vs a "Vytautas" mascot, or a character
        // never promoted) would otherwise drop silently and cost character identity on every panel.
        const known = new Set(roster.map((m) => m.name));
        const used = new Set([...cfg.cast, ...cfg.panels.flatMap((p) => p.uses?.avatars ?? [])]);
        const unknown = [...used].filter((n) => !known.has(n));
        if (unknown.length) {
          ctx.break(i18n.t("plugins.comics.unknownMascot", { names: unknown.join(", "), roster: [...known].join(", ") || "—" }));
        }
        const cast: Record<string, string> = {};
        for (const m of roster) if (cfg.cast.includes(m.name)) cast[m.name] = m.image;
        return { goTo: "setup", input: { cfg, layout, cast, panel: 1, completed: {} } satisfies Flow };
      },
    },

    // The secured folder: comics/<name>/ — the name is a HANDLE, not content: on collision take the
    // next free suffix deterministically (a crashed run's leftover folder must never park the flow
    // to ask a human for a string). Once secured, pasted img-N references materialize into refs/
    // (files are the cross-session currency the heads need).
    setup: {
      start: async (ctx, input) => {
        const f = input as Flow;
        const base = slug(f.cfg.name);
        for (let n = 1; n <= 50; n++) {
          const name = n === 1 ? base : `${base}-${n}`;
          const dir = `/workspace/${settings().comicsDir}/${name}`;
          // One List of the target folder — occupied is a non-empty listing (never a workspace walk).
          const ls = await ctx.runTool("List", { path: dir });
          if (ls?.ok && ls.output.split("\n").slice(1).some((l) => l.trim() !== "")) continue;
          if (!ls?.ok) {
            const made = await ctx.runTool("CreateFolder", { path: dir });
            if (!made?.ok) ctx.break(i18n.t("plugins.comics.promoteFailed", { error: made?.output ?? "no tool gateway" }));
          }
          f.cfg.name = name;
          return { value: null };
        }
        return ctx.break(i18n.t("plugins.comics.promoteFailed", { error: `no free folder name for "${base}"` }));
      },
      end: async (ctx, input) => {
        const f = input as Flow;
        for (const p of f.cfg.panels) {
          const imgs = p.uses?.images ?? [];
          for (let i = 0; i < imgs.length; i++) {
            if (!isMediaRef(imgs[i])) continue;
            const dest = `${refsDir(f)}/${imgs[i]}.png`;
            const cp = await ctx.runTool("Copy", { from: imgs[i], to: dest });
            if (!cp?.ok) return ctx.break(i18n.t("plugins.comics.promoteFailed", { error: cp?.output ?? "no tool gateway" }));
            imgs[i] = dest;
          }
        }
        return { goTo: "frame", input: f };
      },
    },

    // One FRESH generating head per frame, under a session job (aspect + silent budget). Its chosen
    // attempt goes to the independent checker — never straight to the page.
    frame: {
      start: async (ctx, input) => {
        const f = input as Flow;
        const p = f.cfg.panels[f.panel - 1];
        // Only the bibles of characters IN this panel — a fresh head needs context, not the whole cast.
        const roster = await readRoster(ctx);
        const bibles = roster.filter((m) => (p.uses?.avatars ?? []).includes(m.name)).map((m) => m.bible);
        return {
          agent: {
            agentId: "comics:frame",
            task: frameTask(f, bibles),
            // No required field: the answer is EITHER {best} or {resubmit, argument} — the contract
            // enforces JSON-ness, frame.end validates the shape (bad → badBest park).
            schema: { required: [] },
            // Every reference image (and the rejected attempt on a refire) is SEEDED — loaded into the
            // head's opening for real, so its first step is looking, not deciding whether to fetch.
            seedFiles: [...panelRefs(f).map((r) => r.path), ...(f.rejected ? [f.rejected] : [])],
            meta: {
              generationJob: {
                kind: "panel",
                aspect: f.layout.slots[f.panel - 1].aspect,
                quality: "super",
                max: settings().maxPanelAttempts,
                comic: slug(f.cfg.name),
                panel: f.panel,
              },
            },
          },
        };
      },
      end: async (ctx, input, response) => {
        const f = input as Flow;
        const r = JSON.parse(String(response)) as { best?: number; resubmit?: boolean; argument?: string };
        // CONTEST: the generator may resubmit a checker-rejected candidate with an argument — a good
        // image must not die to a mistaken validation. User rejections are never contestable.
        if (r.resubmit && f.rejected && f.rejectedBy === "check") {
          const contest = r.argument?.trim() || "the generator contests the rejection as mistaken";
          return { goTo: "check", input: { ...f, pending: f.rejected, contest, feedback: undefined, rejected: undefined, rejectedBy: undefined } satisfies Flow };
        }
        // Normal path: the head returns an attempt NUMBER — the graph builds the path (models
        // retyping 26-char ULID paths was a typo farm, especially under speculative decoding).
        const path = await resolveAttempt(ctx, Number(r.best));
        if (!path) ctx.break(i18n.t("plugins.comics.badBest", { best: String(r.best ?? r.resubmit ?? "") }));
        return { goTo: "check", input: { ...f, pending: path as string, contest: undefined } satisfies Flow };
      },
    },

    // The independent gate: a fresh checker head (it cannot generate) judges the candidate against the
    // same spec. Rejection refires the frame (capped); approval — or the cap — secures the panel.
    check: {
      start: (_ctx, input) => {
        const f = input as Flow;
        return {
          agent: {
            agentId: "comics:check",
            task: checkTask(f),
            schema: { required: ["approved"] },
            // Candidate + every reference seeded — the checker structurally cannot skip looking.
            seedFiles: [...(f.pending ? [f.pending] : []), ...panelRefs(f).map((r) => r.path)],
          },
        };
      },
      end: async (ctx, input, response) => {
        const f = input as Flow;
        const { approved, issues } = JSON.parse(String(response)) as { approved: boolean; issues?: string };
        const refires = f.refires ?? 0;
        if (!approved && refires < MAX_REFIRES) {
          return {
            goTo: "frame",
            input: {
              ...f,
              pending: undefined,
              refires: refires + 1,
              feedback: `the checker rejected the previous version: ${issues || "no reason given"}`,
              rejected: f.pending,
              rejectedBy: "check",
              contest: undefined,
            } satisfies Flow,
          };
        }
        // SECURE the candidate: copy (scratch keeps the history) into the comic's folder.
        const dest = `/workspace/${settings().comicsDir}/${slug(f.cfg.name)}/panel${f.panel}.png`;
        const cp = await ctx.runTool("Copy", { from: f.pending, to: dest });
        if (!cp?.ok) ctx.break(i18n.t("plugins.comics.promoteFailed", { error: cp?.output ?? "no tool gateway" }));
        const next: Flow = { ...f, completed: { ...f.completed, [f.panel]: dest }, pending: undefined, refires: undefined, feedback: undefined, rejected: undefined, rejectedBy: undefined, contest: undefined };
        if (f.cfg.userValidation) return { goTo: "frameReview", input: next };
        return advance(next);
      },
    },

    // Optional per-frame user gate (chosen in the plan).
    frameReview: {
      start: (_ctx, input) => {
        const f = input as Flow;
        // Method + contract in the comics:review agent's system prompt — the task is the panel's data.
        return {
          dialog: {
            agentId: "comics:review",
            task: `Review panel ${f.panel} of ${f.cfg.panels.length} with the user. The panel: ${f.completed[f.panel]}. The scene it should show: ${f.cfg.panels[f.panel - 1].scene}`,
            schema: { required: ["approved"] },
            // The panel is seeded — visible to agent AND user the moment the review chat opens.
            seedFiles: [f.completed[f.panel]],
          },
        };
      },
      end: async (ctx, input, response) => {
        const f = input as Flow;
        const { approved, feedback } = JSON.parse(String(response)) as { approved: boolean; feedback?: string };
        if (!approved) {
          const fixed = await materializeFeedback(ctx, f, feedback || "the user rejected it — improve the panel");
          // The rejected panel leaves `completed` — advance() will route back to it, and the refire
          // must not pass it off as secured.
          const { [f.panel]: rejected, ...completed } = f.completed;
          return {
            goTo: "frame",
            input: { ...f, completed, feedback: fixed, rejected, rejectedBy: "review", contest: undefined } satisfies Flow,
          };
        }
        return advance(f);
      },
    },

    // Deterministic: compose the page and secure it as comics/<name>/page.png.
    compose: {
      start: async (ctx, input) => {
        const f = input as Flow;
        // Fired directly with holes in `completed`? Park naming the gap instead of composing blanks.
        const missing = nextMissing(f);
        if (missing !== null) ctx.break(i18n.t("plugins.comics.panelsMissing", { panel: missing }));
        const today = new Date().toISOString().slice(0, 10);
        // Masthead fields are PLAN-AUTHORED (agreed with the user); today's date is only the
        // fallback when the plan carries none.
        const res = await ctx.runTool("GalleryCompose", {
          templateId: f.layout.handle,
          images: f.cfg.panels.map((_p, i) => f.completed[i + 1]),
          title: f.cfg.title,
          date: f.cfg.date?.trim() || today,
          credit: f.cfg.credit?.trim() || undefined,
          name: `${slug(f.cfg.name)}-page`,
          overwrite: true,
        });
        if (!res?.ok) return ctx.break(i18n.t("plugins.comics.promoteFailed", { error: res?.output ?? "no tool gateway" }));
        const scratch = /Saved to (\S+\.png)/.exec(res.output)?.[1] ?? "";
        const dest = `/workspace/${settings().comicsDir}/${slug(f.cfg.name)}/page.png`;
        const cp = await ctx.runTool("Copy", { from: scratch, to: dest });
        if (!cp?.ok) return ctx.break(i18n.t("plugins.comics.promoteFailed", { error: cp?.output ?? "no tool gateway" }));
        return { value: dest };
      },
      end: (_ctx, input, response) => ({ goTo: "finish", input: { ...(input as Flow), page: String(response) } }),
    },

    // Deterministic epilogue: every cast bible gets the story record + its settled lore changes, the
    // lore goes to memory (best-effort — memory offline never blocks the comic), then the audit exits.
    finish: {
      start: async (ctx, input) => {
        const f = input as Flow;
        const date = new Date().toISOString().slice(0, 10);
        const lore = f.cfg.lore ?? [];
        for (const [name, imgPath] of Object.entries(f.cast)) {
          const sheet = biblePath(imgPath);
          const read = await ctx.runTool("Read", { path: sheet });
          if (!read?.ok) continue;
          try {
            const bible = JSON.parse(stripRead(read.output)) as { stories?: unknown[]; lore?: unknown[] };
            bible.stories = [...(bible.stories ?? []), { date, title: f.cfg.title, summary: f.cfg.synopsis, page: f.page }];
            const notes = lore.filter((l) => l.mascot === name);
            if (notes.length) bible.lore = [...(bible.lore ?? []), ...notes.map((l) => ({ date, note: l.note }))];
            await ctx.runTool("Write", { path: sheet, content: JSON.stringify(bible, null, 2) });
          } catch {
            // an unparseable bible never blocks the finished comic
          }
        }
        const workspace = getContainer(getSession(ctx.sid)?.containerId)?.name;
        for (const l of lore) {
          await ctx.runTool("SaveMemory", {
            content: `Comic mascot "${l.mascot}"${workspace ? ` (workspace "${workspace}")` : ""} — lore update (${date}, from "${f.cfg.title}"): ${l.note}`,
            scope: "private",
            category: "comics-mascots",
          });
        }
        // `show` makes the exit LOAD the finished page into the chat (real ImageLoad card) — the
        // result is seen, not hunted down in a folder.
        return { value: { title: f.cfg.title, page: f.page, panels: f.completed, layout: f.layout.handle, show: f.page ? [f.page] : [] } };
      },
      end: (_ctx, _input, response) => ({ goTo: EXIT, input: response }),
    },
  };
}
