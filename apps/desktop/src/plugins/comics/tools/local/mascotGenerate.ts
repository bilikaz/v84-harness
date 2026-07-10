// MascotGenerate — the mascot flow's only generation surface. On top of the shared reference law
// (structured entries, style ≤2, attempt ≤1, total ≤4, aliases spoken in the prompt) its own contract:
// subjects capped at 2 (the user's source material — photo/sketch/primitives), references optional,
// and it only runs under an `avatar` job.

import { type ToolSpec } from "../../../../core/tools/types.ts";
import { ComicsGenerateBase, type GenRef } from "./base.ts";

const ROLE_ORDER: Record<string, number> = { subject: 0, style: 1, attempt: 2 };

export class MascotGenerate extends ComicsGenerateBase {
  protected kind(): "avatar" {
    return "avatar";
  }
  protected refsRule(refs: GenRef[]): string | null {
    for (const r of refs) {
      if (!(String(r.role) in ROLE_ORDER)) {
        return `reference "${r.alias}" has role "${String(r.role ?? "")}" — use "subject" (the user's source material), "style" (how the result should look), or "attempt" (your previous attempt).`;
      }
    }
    const byRole = (role: string): number => refs.filter((r) => r.role === role).length;
    if (byRole("subject") > 2) return "at most 2 subject references — pick the user's strongest source material.";
    if (byRole("style") > 2) return "at most 2 style references — the look is better captured in fewer, stronger samples.";
    if (byRole("attempt") > 1) return "at most 1 attempt reference — only the previous one matters; to make room past the 4-reference cap, drop a style reference and explain in the attempt's description what to fix.";
    return null;
  }
  // Priority = position order: subjects first (the positions image models weigh most).
  protected override arrange(refs: GenRef[]): GenRef[] {
    return [...refs].sort((a, b) => (ROLE_ORDER[String(a.role)] ?? 9) - (ROLE_ORDER[String(b.role)] ?? 9));
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "MascotGenerate",
        description:
          "Generate a mascot (avatar) attempt. Format, quality, and output are configured by the flow — you " +
          "provide the prompt and structured references (max 4). Roles: \"subject\" (max 2) = what the mascot " +
          "derives from (the user's photo/sketch/primitives) — if the user provided any, they are MANDATORY on " +
          "EVERY generation, first priority; \"style\" (max 2) = how the result should look; \"attempt\" " +
          "(max 1) = your previous attempt — past the cap, drop a style reference to make room and explain in " +
          "the attempt's description what to fix. When told the budget is exhausted, review all attempts and " +
          "choose the best.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              description:
                "A DETAILED generation prompt in YOUR words — several sentences: subject, pose, expression, " +
                "clothing, colors, background, lighting, art style. VAGUE PROMPTS PRODUCE UNPREDICTABLE " +
                "RESULTS — everything you don't specify, the image model invents. Mention every reference by " +
                "its alias (\"a bubble-head version of person, rendered like target\") — the tool prepends a " +
                "reference manifest and rewrites aliases to image positions for the server.",
            },
            references: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  image: { type: "string", description: "Workspace path or img-N alias of the image." },
                  alias: { type: "string", description: "Short handle your prompt speaks in, e.g. \"person\", \"target\"." },
                  description: { type: "string", description: "The targeted object / points of interest in the image, e.g. \"the man from the profile photo — sharp jaw, glowing blue eyes\"." },
                  role: { type: "string", enum: ["subject", "style", "attempt"], description: "subject = source material the mascot derives from; style = how the result should look; attempt = your previous attempt." },
                },
                required: ["image", "alias", "description", "role"],
              },
              description:
                "Up to 4 structured references, priority subject > style > attempt. User-provided subject " +
                "material is MANDATORY every generation, all rounds.",
            },
          },
          required: ["prompt"],
        },
      },
    };
  }
}
