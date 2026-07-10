// SessionLoopBase — THE loop, sequenced ONCE (implementation.md). There is no "turn containing
// steps": an iteration IS the step; a "turn" is just the run of iterations until a text-only
// response. Subclasses are response producers and tool dispatchers — the llm shape (lease,
// projection, streaming) and the graph shape (nodes emitting tool calls) — and never touch the
// sequencing. Per docs/conventions/base-classes.md: uniform constructor carrying the per-run
// context (instances are cheap, one per loop entry — dynamic mode falls out, since each entry
// constructs the shape the session's CURRENT meta selects), `init()` hook, plumbing as protected
// members.
//
// Contract healing lives IN the loop: reactions are re-iterations (resume/correct feed back into
// respond as the next input), never a bolted-on layer with its own dispatch. Settlement is an
// EVENT (records.ts): the loop emits end(sid, ok|fail, data); listeners — a parent Call, the UI,
// persistence — consume it; nobody holds a return address.

import { classify, correctionFor, reactionFor, type Contract, type FaultKind, type Verdict } from "./contract.ts";
import { emitSettlement, type InboxStore, type PendingMessage, type Settlement } from "./records.ts";

// What one iteration feeds the response producer.
export type LoopInput =
  | { kind: "go" } // proceed from the stored history as-is (the opener: runTurn already pushed the user turn)
  | { kind: "task"; text: string } // an opening message the driver must apply (DATA only by convention)
  | { kind: "message"; text: string } // an engine-authored correction turn
  | { kind: "messages"; messages: PendingMessage[] } // drained pending inbox
  | { kind: "toolResults"; results: ToolResultMsg[] } // last iteration's dispatched calls
  | { kind: "resume" }; // re-drive; the driver drops the broken tail from its projection

export interface ToolCallReq {
  id: string;
  name: string;
  arguments: string;
}
export interface ToolResultMsg {
  callId: string;
  output: string;
}

// The ONE envelope both drivers produce — the loop cannot tell an llm from a graph.
export interface ResponseEnvelope {
  text: string;
  toolCalls?: ToolCallReq[];
  errored?: boolean; // response production failed (provider error, dead turn)
  fatal?: boolean; // with errored: beyond ANY automatic repair (capacity/context-full) — escalate now
  aborted?: boolean; // a soft Stop — a PAUSE (the loop waits); only a hard ctx.signal abort settles
  yield?: boolean; // output delivered but NOT final (a park message, help) — print and wait for input
}

export type LoopState = "running" | "healing" | "waiting" | "settled" | "failed";

// The per-run context, wired at construction — methods never thread it as parameters.
export interface LoopContext {
  sid: string;
  contract: Contract;
  budget: number; // automatic-repair budget (heals); user steering is never budgeted
  maxSteps: number; // consecutive tool-call iterations per input before the loop refuses to spin
  signal?: AbortSignal; // hard abort — settles the run aborted (a soft Stop is the envelope's `aborted`)
  inbox?: InboxStore; // pending-message store; absent → injection-while-busy not wired (tests)
}

export abstract class SessionLoopBase {
  constructor(protected readonly ctx: LoopContext) {
    this.init();
  }
  protected init(): void {}

  // ── Expansion points ────────────────────────────────────────────────────────

  // Produce one response for the input. The llm shape runs a model step; the graph shape emits the
  // current node's action as tool calls. Unit mechanics live behind this seam, never in the loop.
  protected abstract respond(input: LoopInput): Promise<ResponseEnvelope>;

  // Dispatch one iteration's tool calls (some ARE session calls — recursion happens in there, via
  // waits, not held promises) and return the results the next iteration feeds back.
  protected abstract dispatch(calls: ToolCallReq[]): Promise<ToolResultMsg[]>;

  // Interactive only: the next user-driven input when the loop yields (`wait`). The pushed seam —
  // a user message on this surface resolves it.
  protected abstract nextUserInput(): Promise<LoopInput>;

  // The contract check for a settled reply — override to add a custom validator ON TOP of the
  // schema (return an `invalid` verdict carrying the validator's correction).
  protected classifyReply(text: string): Verdict {
    return classify(text, this.ctx.contract.schema);
  }

  // Lifecycle sink — the state vocabulary the UI renders (silence is never ambiguous). Default
  // no-op; the wired engine forwards to the bus.
  protected onState(_state: LoopState, _round?: number): void {}

  // Called once, with the settlement, before run() returns — the wired shape closes its segment
  // (release lease, final events) here.
  protected onSettle(_s: Settlement): void {}

  // ── THE loop — sequenced once, subclasses never override ───────────────────

  async run(initial: LoopInput): Promise<Settlement> {
    let input: LoopInput = initial;
    let heals = 0;
    let steps = 0; // consecutive tool-call iterations since the last fresh input
    this.onState("running");
    for (;;) {
      if (this.ctx.signal?.aborted) return this.settle(false, "aborted");
      const r = await this.respond(input);

      // A soft Stop PAUSES — any loop, any mode (a stopped head stays resumable; the parent's
      // continue feeds it). Only the hard ctx.signal abort (checked at the top) settles aborted.
      // `yield` is the driver's own "printed, not final" — same wait, no fault.
      if (r.aborted || r.yield) {
        this.onState("waiting");
        input = await this.nextUserInput();
        steps = 0;
        continue;
      }

      // Tool calls → dispatch and feed the results back. This IS the step loop; the cap stops a spin.
      if (!r.errored && r.toolCalls?.length) {
        if (++steps > this.ctx.maxSteps) {
          const v: Verdict = { ok: false, fault: "errored" };
          const spun = this.react(v, heals, true);
          if (spun.done) return spun.settlement;
          ({ input, heals } = spun);
          steps = 0;
          continue;
        }
        input = { kind: "toolResults", results: await this.dispatch(r.toolCalls) };
        continue;
      }

      // Cycle boundary: injected-while-busy messages continue the loop before anything settles.
      const pending = this.ctx.inbox?.drain(this.ctx.sid) ?? [];
      if (pending.length) {
        input = { kind: "messages", messages: pending };
        steps = 0;
        continue;
      }

      // Settle or react — the contract, IN the loop.
      const verdict: Verdict = r.errored ? { ok: false, fault: "errored" } : this.classifyReply(r.text);
      if (verdict.ok) return this.settle(true, verdict.text);
      const acted = this.react(verdict, heals, r.fatal === true);
      if (acted.done) return acted.settlement;
      ({ input, heals } = acted);
      steps = 0;
      // A `wait` reaction yields to the user.
      if (acted.wait) {
        this.onState("waiting");
        input = await this.nextUserInput();
      }
    }
  }

  // One fault → one outcome: escalate (settle not-ok), wait, or a healing re-iteration.
  private react(
    verdict: Verdict & { ok: false },
    heals: number,
    fatal: boolean,
  ): { done: true; settlement: Settlement } | { done: false; input: LoopInput; heals: number; wait?: boolean } {
    const reaction = fatal ? "escalate" : reactionFor(verdict.fault, this.ctx.contract, heals, this.ctx.budget);
    switch (reaction) {
      case "escalate":
        return { done: true, settlement: this.settle(false, verdict.fault) };
      case "wait":
        return { done: false, input: { kind: "go" }, heals, wait: true };
      case "resume":
        this.onState("healing", heals + 1);
        return { done: false, input: { kind: "resume" }, heals: heals + 1 };
      case "correct":
        this.onState("healing", heals + 1);
        return { done: false, input: { kind: "message", text: correctionFor(verdict) }, heals: heals + 1 };
    }
  }

  private settle(ok: boolean, data: string | FaultKind | "aborted"): Settlement {
    const s: Settlement = { sessionId: this.ctx.sid, ok, data: String(data) };
    this.onState(ok ? "settled" : "failed");
    this.onSettle(s);
    emitSettlement(s); // whoever waits — a parent Call, the UI, persistence — captures it
    return s;
  }
}
