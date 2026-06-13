// The Cosmos prompt style, end to end: the structured-JSON schemas + upsampler system prompts (verbatim from cosmos-framework),
// and the heal-looped call that fills them from a short prompt. Any failure falls back to the raw prompt.

import { getAppConfig } from "../../../config/index.ts";
import { stripFences } from "../../../../lib/format.ts";
import { jsonHandler, type LLMClient } from "../../../../llm/index.ts";

const T2I_SCHEMA = `{
  "subjects": [
    { "description": "full visual description of the subject", "appearance_details": "accessories, texture, distinguishing features", "relationship": "how this subject relates to others or the scene", "location": "where in frame (e.g. 'Center foreground')", "relative_size": "size within frame", "orientation": "direction subject faces relative to camera", "pose": "body position and posture", "clothing": "clothing/accessories; '' if N/A", "expression": "facial expression; '' if N/A", "gender": "'Male' | 'Female' | 'Unknown' | 'N/A'", "age": "age category", "skin_tone_and_texture": "'' if non-human", "facial_features": "fine-grained facial attributes; '' if N/A", "number_of_subjects": 0, "number_of_arms": 0, "number_of_legs": 0, "number_of_hands": 0, "number_of_fingers": 0 }
  ],
  "subject_details": {},
  "background_setting": "prose description of the environment",
  "lighting": { "conditions": "", "direction": "'None' for flat images", "shadows": "'None' for flat images", "illumination_effect": "" },
  "aesthetics": { "composition": "", "color_scheme": "dominant colors/palette", "mood_atmosphere": "short phrases", "patterns": "'None' if none" },
  "cinematography": { "framing": "shot type", "camera_angle": "e.g. 'Eye-level'", "depth_of_field": "'Shallow' | 'Deep' | 'Uniform focus' | 'N/A'", "focus": "", "lens_focal_length": "" },
  "style_medium": "e.g. 'Photography'",
  "artistic_style": "genre or approach",
  "context": "scene context (brief)",
  "text_and_signage_elements": [],
  "quadrant_scan": { "top_left": "", "top_right": "", "bottom_left": "", "bottom_right": "", "absolute_center": "" },
  "comprehensive_t2i_caption": "a comprehensive, full-scene natural-language description of the image"
}`;

const T2I_SYSTEM =
  "You are the Cosmos text-to-image prompt upsampler. Given a short image request, output a SINGLE JSON object " +
  "that fills this exact schema — keep every key and the structure, and replace each value with rich, concrete, " +
  "coherent detail for the requested image (invent plausible specifics where the request is vague):\n\n" +
  T2I_SCHEMA +
  "\n\nRules: 'comprehensive_t2i_caption' is a full, vivid description of the whole scene. Use \"\" or 0 where a " +
  "field doesn't apply (e.g. non-human subjects). Do NOT add 'resolution' or 'aspect_ratio' — the system sets " +
  "the image dimensions. Output ONLY the JSON object — no markdown, no code fences, no commentary.";

const T2V_SCHEMA = `{
  "subjects": [
    { "description": "", "appearance_details": "", "location": "", "relative_size": "", "orientation": "", "pose": "", "action": "what the subject DOES over the clip (motion)", "state_changes": "how it changes over time", "clothing": "", "expression": "", "gender": "", "age": "", "facial_features": "", "number_of_subjects": 0 }
  ],
  "background_setting": "",
  "lighting": { "conditions": "", "direction": "", "shadows": "", "illumination_effect": "" },
  "aesthetics": { "composition": "", "color_scheme": "", "mood_atmosphere": "", "patterns": "" },
  "cinematography": { "camera_motion": "how the camera moves (pan/tilt/dolly/static)", "framing": "", "camera_angle": "", "depth_of_field": "", "focus": "", "lens_focal_length": "" },
  "style_medium": "",
  "artistic_style": "",
  "context": "",
  "actions": ["ordered actions/events that happen during the clip"],
  "transitions": [],
  "temporal_caption": "a full description of the WHOLE clip, including what happens over time"
}`;

const T2V_SYSTEM =
  "You are the Cosmos text-to-video prompt upsampler. Turn the user's short request into a SINGLE JSON object " +
  "filling this schema with rich, concrete detail — especially MOTION: per-subject `action`/`state_changes`, " +
  "`camera_motion`, ordered `actions`, and a `temporal_caption` describing the whole clip over time. Keep all " +
  "keys and structure; invent plausible specifics where vague.\n\n" +
  T2V_SCHEMA +
  "\n\nRules: Do NOT add resolution, aspect_ratio, duration, or fps — the system sets those. Output ONLY the JSON " +
  "object: no markdown, no code fences, no commentary.";

async function upsample(
  client: LLMClient,
  prompt: string,
  system: string,
  requiredKey: string,
  signal: AbortSignal | undefined,
  finalize?: (obj: Record<string, unknown>) => void,
): Promise<string> {
  // No pre-check: an unconfigured "main" makes call() throw, and ANY failure falls back to the raw prompt.
  try {
    const obj = await client.call({
      service: "main",
      messages: [{ role: "user", content: prompt }],
      system,
      signal,
      handler: jsonHandler(validate(requiredKey)),
      maxHeals: getAppConfig().upsample.maxAttempts,
    });
    finalize?.(obj);
    return JSON.stringify(obj);
  } catch {
    return prompt;
  }
}

function validate(requiredKey: string): (text: string) => Record<string, unknown> {
  return (text) => {
    const obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("output must be a single JSON object");
    const caption = obj[requiredKey];
    if (typeof caption !== "string" || !caption.trim()) throw new Error(`missing non-empty '${requiredKey}'`);
    if (!Array.isArray(obj.subjects)) throw new Error("missing 'subjects' array");
    return obj;
  };
}

// Upsample a short image prompt into a filled Cosmos T2I schema (JSON string).
export function cosmosImagePrompt(client: LLMClient, prompt: string, signal?: AbortSignal): Promise<string> {
  return upsample(client, prompt, T2I_SYSTEM, "comprehensive_t2i_caption", signal);
}

// Upsample a short video prompt into a filled Cosmos T2V schema; `finalize` injects the resolution/timing the system owns.
export function cosmosVideoPrompt(
  client: LLMClient,
  prompt: string,
  signal: AbortSignal | undefined,
  finalize: (obj: Record<string, unknown>) => void,
): Promise<string> {
  return upsample(client, prompt, T2V_SYSTEM, "temporal_caption", signal, finalize);
}
