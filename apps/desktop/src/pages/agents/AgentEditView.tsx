import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Trash2 } from "lucide-react";

import { ConfirmActions } from "../../components/ConfirmActions.tsx";
import { ToolModePicker } from "../../components/ToolModePicker.tsx";
import { deleteAgent, saveAgent, useAgents } from "../../core/agents.ts";
import { type ToolName, type ToolPermission } from "../../core/tools/types.ts";
import { useGatedTools } from "../../renderer/gatedTools.ts";
import { navigate } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";

const inputCls =
  "rounded-lg border border-neutral-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-neutral-400";
const monoCls =
  "resize-y rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400";

export function AgentEditView({ id }: { id: string }) {
  const { t } = useTranslation();
  const agents = useAgents();
  const gatedTools = useGatedTools();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const agent = agents.find((a) => a.id === id);

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">{t("agents.missing")}</div>
    );
  }

  function doDelete() {
    deleteAgent(id);
    navigate("");
  }

  function setTool(tool: ToolName, mode: ToolPermission) {
    if (!agent) return;
    saveAgent(id, { tools: { ...agent.tools, [tool]: mode } });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-6 py-3">
        <button
          type="button"
          onClick={() => navigate(`agents/${agent.id}`)}
          title={t("agents.backToRun")}
          className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="truncate text-sm font-medium text-neutral-800">
          {agent.name || t("agents.untitled")} — {t("agents.edit")}
        </h1>
        <div className="flex-1" />
        <div className="relative">
          <button
            type="button"
            onClick={() => setConfirmDelete((v) => !v)}
            title={t("agents.delete")}
            className={cn(
              "rounded-lg p-2",
              confirmDelete ? "bg-red-50 text-red-600" : "text-neutral-400 hover:bg-neutral-100 hover:text-red-600",
            )}
          >
            <Trash2 size={16} />
          </button>
          {confirmDelete && (
            <div className="absolute right-0 top-11 z-20 w-60 rounded-xl border border-neutral-200 bg-white p-3 shadow-xl">
              <p className="text-sm text-neutral-700">{t("agents.confirmDelete")}</p>
              <ConfirmActions
                cancelLabel={t("agents.cancel")}
                confirmLabel={t("agents.delete")}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={doDelete}
                danger
              />
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <Field label={t("agents.name")} help={t("agents.nameHelp")}>
            <input
              value={agent.name}
              onChange={(e) => saveAgent(id, { name: e.target.value })}
              placeholder={t("agents.namePlaceholder")}
              className={inputCls}
            />
          </Field>

          <Field label={t("agents.description")} help={t("agents.descriptionHelp")}>
            <textarea
              value={agent.description}
              onChange={(e) => saveAgent(id, { description: e.target.value })}
              placeholder={t("agents.descriptionPlaceholder")}
              rows={2}
              className={cn(inputCls, "resize-y")}
            />
          </Field>

          <Field label={t("agents.system")} help={t("agents.systemHelp")}>
            <textarea
              value={agent.system}
              onChange={(e) => saveAgent(id, { system: e.target.value })}
              placeholder={t("agents.systemPlaceholder")}
              rows={10}
              className={monoCls}
            />
          </Field>

          <Field label={t("agents.user")} help={t("agents.userHelp")}>
            <textarea
              value={agent.user}
              onChange={(e) => saveAgent(id, { user: e.target.value })}
              placeholder={t("agents.userPlaceholder")}
              rows={6}
              className={monoCls}
            />
          </Field>

          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
            <span className="text-sm font-medium text-neutral-800">{t("agents.workspaceSection")}</span>
            <label className="flex items-center gap-2 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={agent.workspace}
                onChange={(e) => saveAgent(id, { workspace: e.target.checked })}
              />
              {t("agents.workspace")}
            </label>
            <span className="text-xs text-neutral-400">{t("agents.workspaceHelp")}</span>
            {agent.workspace && (
              <>
                <span className="pt-1 text-xs text-neutral-400">{t("agents.permissionsHelp")}</span>
                <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 pt-1">
                  {gatedTools.map((d) => (
                    <div key={d.name} className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-neutral-700">{d.name}</span>
                      <ToolModePicker
                        value={agent.tools[d.name] ?? 2}
                        onChange={(m: ToolPermission) => setTool(d.name, m)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-neutral-800">{props.label}</span>
      <span className="text-xs text-neutral-400">{props.help}</span>
      {props.children}
    </div>
  );
}