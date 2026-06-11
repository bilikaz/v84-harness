import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck, Unlink } from "lucide-react";

import { sessionToolModes, unlinkAgent, useActiveSession } from "../../core/sessions/index.ts";
import { useAgents } from "../../core/agents.ts";
import { useWorkspaces } from "../../core/workspaces.ts";
import { ALL_TOOLS, type ToolMode } from "../../core/tools/types.ts";
import { ConfirmActions } from "../../components/ConfirmActions.tsx";
import { cn } from "../../lib/cn.ts";

// Right-panel contribution: rendered ONLY while the active session is
// agent-based (agentId linked) — a plain session never shows it. One line says
// the agent's permissions govern this session; the accordion expands to the
// per-tool effective modes (the same min(workspace grant, agent ceiling) the
// turn loop uses — sessionToolModes). Unlink converts the session to a plain
// one (workspace/chat permissions from the next turn) and the card disappears
// with the link. A stale link (agent deleted) is announced the same way: plain
// workspace permissions already apply, unlink just clears the leftover.
const MODE_KEY: Record<ToolMode, string> = { 0: "workspace.modeOff", 1: "workspace.modeAsk", 2: "workspace.modeAuto" };

export function AgentPermissionsPanel() {
  const { t } = useTranslation();
  const session = useActiveSession();
  const agents = useAgents();
  useWorkspaces(); // a workspace policy edit changes the effective modes below
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!session.agentId) return null;
  const agent = agents.find((a) => a.id === session.agentId);
  const modes = sessionToolModes(session);
  const status = !agent
    ? t("agents.permissionsDeleted")
    : agent.workspace
      ? t("agents.permissionsWorkspace", { name: agent.name || t("agents.untitled") })
      : t("agents.permissionsChat", { name: agent.name || t("agents.untitled") });

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-sm font-semibold text-neutral-900"
      >
        <ShieldCheck size={15} className="shrink-0 text-neutral-500" />
        {t("agents.permissionsTitle")}
        <ChevronDown size={14} className={cn("ml-auto text-neutral-400 transition-transform", open && "rotate-180")} />
      </button>
      <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{status}</p>
      {open && (
        <>
          <ul className="mt-2 space-y-0.5">
            {ALL_TOOLS.map((name) => (
              <li key={name} className="flex items-center justify-between text-xs">
                <span className="text-neutral-600">{name}</span>
                <span className={cn("font-medium", modes[name] === 0 ? "text-neutral-400" : "text-neutral-700")}>
                  {t(MODE_KEY[modes[name]])}
                </span>
              </li>
            ))}
          </ul>
          {/* No unlink on a sub-agent run: it's read-only — there is no next
              message for the converted permissions to apply to. */}
          {session.parentId ? null : confirm ? (
            <div className="mt-3 rounded-lg bg-neutral-50 p-3">
              <p className="text-xs text-neutral-700">{t("agents.confirmUnlink")}</p>
              <p className="mt-1 text-xs text-neutral-500">{t("agents.unlinkHint")}</p>
              <ConfirmActions
                cancelLabel={t("agents.cancel")}
                confirmLabel={t("agents.unlink")}
                onCancel={() => setConfirm(false)}
                onConfirm={() => {
                  setConfirm(false);
                  unlinkAgent(session.id);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              <Unlink size={13} />
              {t("agents.unlink")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
