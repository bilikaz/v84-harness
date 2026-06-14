import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { useActiveSession, useSessions } from "../../core/sessions/index.ts";
import { useCtx } from "../../renderer/ctx.tsx";

export function SubAgentCleanup() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const session = useActiveSession();
  const children = useSessions().filter((s) => s.parentId === session.id);
  if (!children.length) return null;
  return (
    <button
      type="button"
      onClick={() => children.forEach((c) => ctx.sessions.deleteSession(c.id))}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
    >
      <Trash2 size={14} /> {t("agents.deleteSubAgents", { n: children.length })}
    </button>
  );
}
