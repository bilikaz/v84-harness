import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";

import { useAgents } from "../../core/agents.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import { useActiveWorkspaceId } from "../../core/workspaces.ts";
import { navigate } from "../../lib/router.ts";
import { Composer } from "../workspace/Composer.tsx";
import type { Attachments } from "../../core/sessions/index.ts";
import { SystemBanner } from "../workspace/SystemBanner.tsx";

export function AgentRunView({ id }: { id: string }) {
  const { t } = useTranslation();
  const ctx = useCtx();
  const agents = useAgents();
  const workspaceId = useActiveWorkspaceId();
  const agent = agents.find((a) => a.id === id);

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">{t("agents.missing")}</div>
    );
  }
  const needsWorkspace = agent.workspace && workspaceId === null;

  function run(text: string, atts: Attachments) {
    if (!agent) return;
    ctx.sessions.runAgent(agent, text, atts);
    navigate("");
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-6 py-3">
        <h1 className="truncate text-sm font-medium text-neutral-800">{agent.name || t("agents.untitled")}</h1>
        <button
          type="button"
          onClick={() => navigate(`agents/${agent.id}/edit`)}
          title={t("agents.edit")}
          className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <Pencil size={15} />
        </button>
        <div className="flex-1" />
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-4">
          <SystemBanner name={agent.name || t("agents.untitled")} system={agent.system} defaultOpen />
          {agent.description && <p className="px-1 text-sm text-neutral-500">{agent.description}</p>}
        </div>
      </div>

      <div className="px-6 pb-6">
        {needsWorkspace && (
          <p className="mx-auto mb-2 max-w-3xl text-center text-xs text-amber-600">{t("agents.needsWorkspace")}</p>
        )}
        <Composer key={agent.id} seed={agent.user} disabled={needsWorkspace} onSubmit={run} />
      </div>
    </div>
  );
}
