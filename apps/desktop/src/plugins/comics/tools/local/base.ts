// The shared BUDGETED generation body behind MascotGenerate/PanelGenerate (a base.ts, so the registry
// never instantiates it). The agent provides ONLY prompt + references; everything else (aspect, quality,
// attempt budget) comes from the session's `generationJob` — a comics-owned extension key the graph
// patches into session.meta at construction, riding to the tool on every call (core stays blind to its
// shape). Attempts land as jobs/<sessionId>/attempt-N.png inside scratch — the
// files ARE the ledger (counted, never stored elsewhere), each session is its own namespace
// (concurrency-proof), and the budget is INVISIBLE until it binds: at the cap the tool refuses and
// instructs choosing the best attempt. Subclasses carry the agent-facing contract: name, description,
// job kind, and the reference rule (mascot ≤3, panel ≥1).

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Image, type ToolResult } from "../../../../core/tools/types.ts";
import type { ToolRunCtx } from "../../../../core/tools/types.ts";
import { BaseWorkspaceTool } from "../../../../core/tools/local/base.ts";
import { isMediaRef } from "../../../../core/sessions/mediaRefs.ts";
import { mimeToExt, parseDataUrl } from "../../../../lib/dataUrl.ts";
import { getAppConfig } from "../../../../core/config/index.ts";
import { MAX_SID_WINDOWS, ownerMarker, sidWindow } from "../../manifest.ts";
import { runImageGeneration } from "../../../../core/tools/helpers/imageGeneration.ts";
import { prepareWorkspaceImageSave, readWorkspaceImage } from "../../../../core/tools/helpers/imageSave.ts";

// The comics generation-job config — the value of the `generationJob` extension key in session.meta.
// Owned entirely by this plugin: the graphs write it, these tools read it, core just carries it.
export interface GenerationJob {
  kind: "avatar" | "panel";
  aspect: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  quality: "low" | "good" | "super";
  max: number; // attempt budget — the tool refuses past it and instructs choosing the best attempt
  comic?: string; // audit labels — the tool ignores them
  panel?: number;
}

// A structured reference — the agent declares WHAT it attaches, so attachment order can never confuse:
// the tool owns the alias → position translation. `role` exists only where a tool's contract defines
// roles (MascotGenerate: subject/style/attempt); PanelGenerate references are role-less.
export interface GenRef {
  image: string; // workspace path or img-N alias
  alias: string; // the handle the agent's prompt speaks in
  description: string; // the targeted object / points of interest in the image
  role?: string;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Alias occurrences in prose — bounded so "mia" never matches inside "premian".
const aliasRe = (alias: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(alias)}(?![\\p{L}\\p{N}_-])`, "giu");

export abstract class ComicsGenerateBase extends BaseWorkspaceTool {
  protected abstract kind(): GenerationJob["kind"];
  // This tool's reference contract on top of the shared law — a string is the refusal reason, null passes.
  protected abstract refsRule(refs: GenRef[]): string | null;
  // This tool's priority ordering (position order for the server) — default: as the agent passed them.
  protected arrange(refs: GenRef[]): GenRef[] {
    return refs;
  }

  override single(): boolean {
    return true; // the attempt ledger is the file count — one generation per step keeps it race-free
  }

  async run(args: Record<string, unknown>, cwd: string, signal?: AbortSignal, ctx?: ToolRunCtx): Promise<ToolResult> {
    const name = this.schema.function.name;
    const job = ctx?.meta?.generationJob as GenerationJob | undefined;
    const sid = ctx?.sessionId;
    if (!job || !sid || job.kind !== this.kind()) {
      return { ok: false, output: `${name} rejected: no matching generation job is configured for this session — this tool only works inside its comics flow.` };
    }
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, output: `${name} rejected: missing required "prompt".` };

    // The shared reference law: full structured entries, unique short aliases, total ≤4, every alias
    // spoken in the prompt. Role semantics (if any) belong to the subclass contract.
    const raw = Array.isArray(args.references) ? args.references : [];
    const refs: GenRef[] = [];
    const seen = new Set<string>();
    for (const e of raw) {
      const r = (e ?? {}) as Record<string, unknown>;
      const image = String(r.image ?? "").trim();
      const alias = String(r.alias ?? "").trim();
      const description = String(r.description ?? "").trim();
      const role = String(r.role ?? "").trim() || undefined;
      if (!image || !alias || !description) {
        return { ok: false, output: `${name} rejected: every reference needs {image, alias, description} — image is a workspace path or img-N alias, alias is the short handle your prompt speaks in, description names the targeted object / points of interest.` };
      }
      if (alias.length > 30 || /["'\n]/.test(alias)) {
        return { ok: false, output: `${name} rejected: alias "${alias}" — keep aliases short (≤30 chars), no quotes.` };
      }
      if (seen.has(alias.toLowerCase())) {
        return { ok: false, output: `${name} rejected: duplicate alias "${alias}" — every reference needs its own.` };
      }
      seen.add(alias.toLowerCase());
      refs.push({ image, alias, description, role });
    }
    if (refs.length > 4) {
      return {
        ok: false,
        output:
          `${name} rejected: at most 4 references per generation — even frontier models degrade past that. ` +
          `Drop the least important ones, or work in STAGES: generate the core first, then use your best ` +
          `attempt as the base and add the remaining elements.`,
      };
    }
    const rule = this.refsRule(refs);
    if (rule) return { ok: false, output: `${name} rejected: ${rule}` };
    for (const r of refs) {
      if (!aliasRe(r.alias).test(prompt)) {
        return { ok: false, output: `${name} rejected: reference "${r.alias}" is never mentioned in the prompt — write the prompt in your own words using your aliases ("${r.alias} stands by the door"); the tool translates them to image positions for the server.` };
      }
    }
    const ordered = this.arrange(refs);

    // The session's job folder: a SHORT sid window (models read these paths), slid past any foreign
    // collision — ours is the first candidate that is free or carries our owner marker.
    let short = "";
    let files: string[] = [];
    for (let off = 0; off <= MAX_SID_WINDOWS; off++) {
      const cand = sidWindow(sid, off);
      try {
        const entries = await readdir(path.resolve(cwd, "generated-images", "jobs", cand));
        if (!entries.includes(ownerMarker(sid))) continue; // someone else's folder — slide the window
        short = cand;
        files = entries;
      } catch {
        short = cand; // free — first write claims it (marker below)
      }
      break;
    }
    if (!short) return { ok: false, output: `${name} failed: could not allocate a job folder for this session.` };
    const jobDir = `jobs/${short}`;
    // The ledger: existing attempt files in the folder.
    const attempts = files.filter((f) => /^attempt-\d+\./.test(f)).length;
    const n = attempts + 1;
    if (n > job.max) {
      return {
        ok: false,
        output:
          `Attempt budget exhausted (${job.max}). Review your attempts in /workspace/generated-images/${jobDir}/ ` +
          `(attempt-1 … attempt-${attempts}) with ImageLoad, CHOOSE THE BEST ONE, and reply with your final ` +
          `JSON using that attempt's NUMBER (e.g. 3 for attempt-3).`,
      };
    }

    // Resolve images in priority order: pasted-media aliases (img-N) from the conversation, everything
    // else a workspace path. Any references at all → the edit path; none → plain generation.
    const inputs: { b64: string; mime: string }[] = [];
    for (const r of ordered) {
      if (isMediaRef(r.image)) {
        const hit = ctx?.mediaRefs?.[r.image];
        const parsed = hit ? parseDataUrl(hit.url) : null;
        if (!parsed || !parsed.mime.startsWith("image/")) {
          return { ok: false, output: `${name} rejected: unknown or non-image reference "${r.image}" ("${r.alias}") — use an img-N alias shown in the conversation or a workspace path.` };
        }
        inputs.push(parsed);
        continue;
      }
      const read = await readWorkspaceImage(r.image, cwd, getAppConfig().media);
      if ("error" in read) return { ok: false, output: `${name} rejected: ${read.error}` };
      inputs.push(read);
    }

    // The tool owns the alias → position translation: a manifest line per reference, and every alias
    // mention in the body rewritten to the same `image N ("alias")` notation — one consistent vocabulary.
    let body = prompt;
    ordered.forEach((r, i) => {
      body = body.replace(aliasRe(r.alias), `image ${i + 1} ("${r.alias}")`);
    });
    const finalPrompt = ordered.length
      ? `Reference images, in order:\n${ordered.map((r, i) => `image ${i + 1} ("${r.alias}"): ${r.description}`).join("\n")}\n\n${body}`
      : prompt;

    const prep = prepareWorkspaceImageSave({ root: cwd, name: `${jobDir}/attempt-${n}`, overwrite: true });
    if ("error" in prep) return { ok: false, output: `${name} rejected: ${prep.error}` };

    // Everything server-facing (slot, dimensions, prompt style, the call) is the shared trunk.
    const out = await runImageGeneration(this.llm, { prompt: finalPrompt, inputs, aspect: job.aspect, quality: job.quality, signal });
    if ("error" in out) return { ok: false, output: `${name} ${out.failed ? "failed" : "rejected"}: ${out.error}` };

    const { b64, mime } = out;
    const saved = await prep.write(mime, b64);
    // Claim the folder for this session — the graph resolves attempt numbers through this marker.
    await writeFile(path.resolve(cwd, "generated-images", jobDir, ownerMarker(sid)), sid).catch(() => {});
    const image: Image = { url: `data:${mime};base64,${b64}`, mime, name: `attempt-${n}.${mimeToExt(mime)}` };
    const last = n === job.max;
    return {
      ok: true,
      output: last
        ? `Generated ${saved} (attempt ${n} — shown above). That was the FINAL attempt of the budget — review all attempts in /workspace/generated-images/${jobDir}/ and reply with your final JSON choosing the best attempt's NUMBER.`
        : `Generated ${saved} (attempt ${n} — shown above). Inspect it: regenerate with a refined prompt if it doesn't match the task, or use this attempt's NUMBER (${n}) in your final JSON if it does.`,
      images: [image],
    };
  }
}
