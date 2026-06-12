import { useTranslation } from "react-i18next";
import { Bot, Pencil, Play, Plus } from "lucide-react";

import { createAgent, useAgents, type Agent } from "../../core/agents.ts";
import { runAgent } from "../../core/sessions/index.ts";
import { useActiveWorkspaceId } from "../../core/workspaces.ts";
import { navigate, useRoute } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";

// Right-panel contribution: the agent library, filtered to what the current
// context can run — with "Chat" selected (no workspace) the workspace agents
// are hidden, since there is nothing to bind them to. Row click opens the
// primed run page; play fires the agent immediately with its saved template.
export function AgentsPanel() {
  const { t } = useTranslation();
  const agents = useAgents();
  const workspaceId = useActiveWorkspaceId();
  const route = useRoute();
  const visible = agents.filter((a) => workspaceId !== null || !a.workspace);

  function addNew() {
    const id = createAgent(t("agents.untitled"));
    navigate(`agents/${id}/edit`); // a fresh agent opens straight into edit mode
  }

  // Immediate run with the saved template; an agent without one opens the run
  // page instead (there is nothing to send yet).
  function play(agent: Agent) {
    if (!agent.user.trim()) {
      navigate(`agents/${agent.id}`);
      return;
    }
    runAgent(agent, agent.user);
    navigate("");
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">{t("agents.title")}</h3>
      </div>
      {visible.map((a) => {
        const active = route === `agents/${a.id}` || route.startsWith(`agents/${a.id}/`);
        return (
          <div
            key={a.id}
            className={cn(
              "group flex items-center gap-0.5 rounded-lg pr-1",
              active ? "bg-neutral-100" : "hover:bg-neutral-100/70",
            )}
          >
            <button
              type="button"
              onClick={() => navigate(`agents/${a.id}`)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-sm",
                active ? "text-neutral-900" : "text-neutral-600",
              )}
            >
              <Bot size={15} className="shrink-0" />
              <span className="truncate">{a.name || t("agents.untitled")}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`agents/${a.id}/edit`)}
              title={t("agents.edit")}
              className="shrink-0 rounded-md p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={() => play(a)}
              title={t("agents.run")}
              className="shrink-0 rounded-md p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-900 group-hover:opacity-100"
            >
              <Play size={13} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addNew}
        className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-400 hover:bg-neutral-100/70 hover:text-neutral-600"
      >
        <Plus size={15} className="shrink-0" />
        {t("agents.new")}
      </button>
    </section>
  );
}
