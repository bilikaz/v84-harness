import { ShieldAlert } from "lucide-react";

import { Modal } from "./Modal.tsx";
import { resolveApproval, usePendingApprovals } from "../core/approvals.ts";
import { useSessions } from "../core/sessions/hooks.ts";

// Shows the next pending tool approval (Allow/Deny). Closing (X/Esc/backdrop) counts as Deny.
export function ApprovalModal() {
  const pending = usePendingApprovals();
  const sessions = useSessions();
  const a = pending[0];
  if (!a) return null;

  // Which session asked — with multiple chats/sub-agents running, the request is otherwise unattributed.
  const session = sessions.find((s) => s.id === a.sessionId);
  const parent = session?.parentId ? sessions.find((s) => s.id === session.parentId) : undefined;
  const asker = session?.title ?? "an ended session";

  let detail = a.call.arguments;
  try {
    detail = JSON.stringify(JSON.parse(a.call.arguments || "{}"), null, 2);
  } catch {
    /* show raw */
  }

  return (
    <Modal open onClose={() => resolveApproval(a.id, false)} className="w-[min(560px,92vw)]">
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 text-amber-600">
          <ShieldAlert size={18} />
          <h2 className="text-base font-semibold text-neutral-900">
            Allow <span className="font-mono">{a.call.name}</span>?
          </h2>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Requested by <span className="font-medium text-neutral-700">{asker}</span>
          {parent ? <span className="text-neutral-400"> · sub-agent of {parent.title}</span> : null}
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          This tool isn’t confined to the workspace folder. Review it before allowing.
        </p>
        <pre aria-label="Tool call arguments" className="mt-3 max-h-64 overflow-auto rounded-lg bg-neutral-900 px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-100">
          {detail}
        </pre>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => resolveApproval(a.id, false)}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            Deny
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolveApproval(a.id, true)}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Allow
          </button>
        </div>
      </div>
    </Modal>
  );
}
