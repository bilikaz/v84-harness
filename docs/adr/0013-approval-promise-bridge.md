# ADR-0013: Approval Promise bridge between the driver and the UI

Status: accepted
Date: 2026-06-10

## Context

Per-tool permission mode 1 ("ask", ADR-0007) means the React-free driver must
suspend mid-turn until a human answers. The driver cannot render UI; the UI
cannot await inside the engine. Callbacks or bespoke events would scatter the
contract.

## Decision

`core/approvals.ts` is a Promise bridge over a transient store:

- `requestApproval(sessionId, call): Promise<boolean>` enqueues a
  `PendingApproval` (carrying its `resolve`) and returns the Promise; the
  driver `await`s it inside the tool-execution `Promise.all`.
- The ApprovalModal renders the queue via `usePendingApprovals()` and settles
  one entry with `resolveApproval(id, ok)`.
- The queue supports concurrent sessions and parallel calls in one step.

**Lifecycle rule (added after the failure-modes review):** every queued Promise
MUST eventually settle — an unanswered approval keeps the turn's `Promise.all`
pending forever. Therefore:

- `stopTurn(sid)` denies the session's queued approvals
  (`denyApprovalsForSession`), and `deleteSession` goes through `stopTurn`.
- After an approval resolves, the driver re-checks the abort signal before
  executing (Stop may have arrived while the prompt sat in the queue).
- On HMR dispose the whole queue is denied — the resolvers belong to the dying
  module instance.

## Consequences

- Approval reads as one awaited line in the driver; all UI complexity lives in
  the modal.
- Deny-by-default on stop/delete/reload means a worst-case race produces a
  denied tool call (visible in the transcript), never a hung turn.
- There is deliberately no timeout: an approval can wait as long as the user
  thinks. The cost is an open turn, which Stop now reliably ends.
