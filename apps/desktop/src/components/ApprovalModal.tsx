import { ShieldAlert } from "lucide-react";

import { Modal } from "./Modal.tsx";
import { resolveApproval, usePendingApprovals } from "../core/approvals.ts";

// Renders the next pending tool approval (e.g. a Bash command the model wants to
// run). Allow / Deny resolve the driver's awaited promise. Closing (X / Esc /
// backdrop) counts as Deny.
export function ApprovalModal() {
  const pending = usePendingApprovals();
  const a = pending[0];
  if (!a) return null;

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
          This tool isn’t confined to the workspace folder. Review it before allowing.
        </p>
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-neutral-900 px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-100">
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
