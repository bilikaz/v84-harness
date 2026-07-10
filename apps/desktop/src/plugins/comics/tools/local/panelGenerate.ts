// PanelGenerate — the comic frame head's only generation surface. On top of the shared reference law
// (structured entries, aliases spoken in the prompt, total ≤4) its own contract: at least 1 reference
// is REQUIRED (a panel is never generated unanchored — there is always a mascot avatar, a source panel,
// or provided content), NO roles (for a panel everything is simply a reference), and it only runs under
// a `panel` job. Scenes needing more than 4 anchors are generated in STAGES (core first, then best
// attempt as base + extras).

import { type ToolSpec } from "../../../../core/tools/types.ts";
import { ComicsGenerateBase, type GenRef } from "./base.ts";

export class PanelGenerate extends ComicsGenerateBase {
  protected kind(): "panel" {
    return "panel";
  }
  protected refsRule(refs: GenRef[]): string | null {
    if (refs.length < 1) {
      return (
        "at least one reference is required — ALWAYS pass the avatar of every mascot in the scene and the " +
        "source panel of anything reused (a previous attempt or provided content also counts)."
      );
    }
    return null;
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "PanelGenerate",
        description:
          "Generate a comic panel attempt. Format, quality, and output are configured by the flow — you " +
          "provide the prompt and 1–4 references (REQUIRED): the avatar of EVERY mascot in the scene and " +
          "the source panel of every reused element, on EVERY generation; add your previous attempt as one " +
          "more when iterating (describe in it what to fix). A scene needing more than 4 anchors is " +
          "generated in STAGES: the core first, then your best attempt as the base plus the remaining " +
          "elements. When told the budget is exhausted, review all attempts and choose the best.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              description:
                "A DETAILED generation prompt in YOUR words — several sentences: composition, every character's " +
                "pose and expression, the setting and its key objects, speech bubble placement and EXACT text, " +
                "lighting, art style. VAGUE PROMPTS PRODUCE UNPREDICTABLE RESULTS — everything you don't " +
                "specify, the image model invents. Mention every reference by its alias " +
                "(\"mia leans over the table, ship hovering behind panel2's doorway\") — the tool prepends a " +
                "reference manifest and rewrites aliases to image positions for the server.",
            },
            references: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  image: { type: "string", description: "Workspace path or img-N alias of the image." },
                  alias: { type: "string", description: "Short handle your prompt speaks in, e.g. \"mia\", \"panel2\", \"prev\"." },
                  description: { type: "string", description: "The targeted object / points of interest in the image, e.g. \"the chrome spaceship in the top-left of this panel\"." },
                },
                required: ["image", "alias", "description"],
              },
              description:
                "1–4 references, most important first. Every mascot in the scene and every reused element's " +
                "source panel MUST be here, every generation.",
            },
          },
          required: ["prompt", "references"],
        },
      },
    };
  }
}
