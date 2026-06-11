import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { deleteSession, useActiveSession, useSessions } from "../../core/sessions/index.ts";

// Right-panel contribution, right below the agent library: one-go cleanup of
// the ACTIVE session's sub-agent runs. Rendered only when there is something
// to delete — no sub-agents, no button. Red because it also kills runs still
// streaming (each parent RunAgent call settles as "stopped"); the answers
// survive in the parent's tool results, only the child transcripts go.
export function SubAgentCleanup() {
  const { t } = useTranslation();
  const session = useActiveSession();
  const children = useSessions().filter((s) => s.parentId === session.id);
  if (!children.length) return null;
  return (
    <button
      type="button"
      onClick={() => children.forEach((c) => deleteSession(c.id))}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
    >
      <Trash2 size={14} /> {t("agents.deleteSubAgents", { n: children.length })}
    </button>
  );
}
