// A small, dependency-free "heal" loop: call a model, validate its output, and
// on failure feed the bad output + the validation error back into the SAME
// conversation and retry — capped. Mirrors the validate/heal path of the
// task-builder runner (apps/api/src/llm/loop.ts) without its streaming,
// logging, or Inngest wiring.
//
// Two callers share this contract:
//   - the chat engine (core/sessions/driver.ts) drives it through the session
//     store + bus rather than a plain return, so it reuses healCorrection() +
//     MAX_HEAL_ATTEMPTS, not healLoop() itself.
//   - standalone callers like the GenerateImage upsampler have no session and
//     use healLoop() directly against a plain fetch.

// Number of heal RETRIES after the initial attempt (so up to MAX+1 model calls).
export const MAX_HEAL_ATTEMPTS = 3;

export interface HealMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// The correction turn appended after a failed validation — quotes the error and
// asks the model to re-emit fixed output. Same shape as the task-builder runner.
export function healCorrection(error: Error): string {
  return (
    `Your previous response could not be used. Validation error:\n${error.message}\n\n` +
    `Re-emit the SAME content, fixed so it parses and validates. ` +
    `JSON only, no prose, no fences. Do not call any tools.`
  );
}

// Run a validate→retry loop against a plain (non-streaming) chat call. `call`
// gets the running message list and returns the model's text. `validate` turns
// that text into T or throws; a throw triggers a heal. After `maxAttempts`
// failed validations the last error propagates — this never returns unvalidated
// output (matches loop.ts's "validated `parsed` or throw" invariant).
export async function healLoop<T>(args: {
  messages: HealMessage[];
  call: (messages: HealMessage[]) => Promise<string>;
  validate: (text: string) => T;
  maxAttempts?: number;
}): Promise<{ value: T; text: string; healAttempts: number }> {
  const max = args.maxAttempts ?? MAX_HEAL_ATTEMPTS;
  const messages = args.messages.slice();
  let healAttempts = 0;
  for (;;) {
    const text = await args.call(messages);
    try {
      return { value: args.validate(text), text, healAttempts };
    } catch (e) {
      if (healAttempts >= max) throw e; // budget spent — propagate, never best-effort
      healAttempts += 1;
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: healCorrection(e as Error) });
    }
  }
}
