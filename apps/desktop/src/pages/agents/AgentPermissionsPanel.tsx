import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck, Unlink } from "lucide-react";

import { unlinkAgent, useActiveSession } from "../../core/sessions/index.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import { useAgents } from "../../core/agents.ts";
import { useWorkspaces } from "../../core/workspaces.ts";
import { type ToolPermission } from "../../core/tools/types.ts";
import { ConfirmActions } from "../../components/ConfirmActions.tsx";
import { cn } from "../../lib/cn.ts";

const MODE_KEY: Record<ToolPermission, string> = { 0: "workspace.modeOff", 1: "workspace.modeAsk", 2: "workspace.modeAuto" };

export function AgentPermissionsPanel() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const session = useActiveSession();
  const agents = useAgents();
  useWorkspaces();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [modes, setModes] = useState<Record<string, ToolPermission>>({});

  // Effective tool modes resolve through the gateway (async in electron) — load them for the active session.
  useEffect(() => {
    let alive = true;
    void ctx.sessions.sessionToolModes(session).then((m) => alive && setModes(m));
    return () => {
      alive = false;
    };
  }, [ctx, session]);

  if (!session.agentId) return null;
  const agent = agents.find((a) => a.id === session.agentId);
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
            {Object.entries(modes).map(([name, mode]) => (
              <li key={name} className="flex items-center justify-between text-xs">
                <span className="text-neutral-600">{name}</span>
                <span className={cn("font-medium", mode === 0 ? "text-neutral-400" : "text-neutral-700")}>
                  {t(MODE_KEY[mode])}
                </span>
              </li>
            ))}
          </ul>
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
