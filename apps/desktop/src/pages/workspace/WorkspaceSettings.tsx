import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderClosed, Trash2 } from "lucide-react";

import { Modal } from "../../components/Modal.tsx";
import { ToolModePicker } from "../../components/ToolModePicker.tsx";
import { fieldInputFull } from "../settings/Field.tsx";
import { useProvider } from "../../core/settings.ts";
import {
  addWorkspace,
  deleteWorkspace,
  updateWorkspace,
  type Workspace,
} from "../../core/workspaces.ts";
import { ALL_TOOLS, type GatedTool, type ToolMode } from "../../core/tools/types.ts";

// Add/edit popup for a workspace. Opened from the sidebar after the folder
// picker (new) or from a workspace row (edit). Self-contained form over a local
// copy of the draft; Save commits to the store.

export function WorkspaceSettings(props: { workspace: Workspace; isNew: boolean; onClose: () => void }) {
  const { workspace, isNew, onClose } = props;
  const { t } = useTranslation();
  const provider = useProvider();
  const [draft, setDraft] = useState<Workspace>(workspace);

  const set = <K extends keyof Workspace>(key: K, value: Workspace[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setTool = (tool: GatedTool, mode: ToolMode) =>
    setDraft((d) => ({ ...d, tools: { ...d.tools, [tool]: mode } }));

  function save() {
    const ws: Workspace = { ...draft, name: draft.name.trim() || draft.root.split(/[/\\]/).pop() || "workspace" };
    if (isNew) addWorkspace(ws);
    else updateWorkspace(ws.id, ws);
    onClose();
  }

  function remove() {
    deleteWorkspace(draft.id);
    onClose();
  }

  return (
    <Modal open onClose={onClose} className="flex max-h-[88vh] w-[min(560px,92vw)] flex-col overflow-hidden">
      <div className="border-b border-neutral-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-neutral-900">{isNew ? t("workspace.addTitle") : t("workspace.editTitle")}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-500">
          <FolderClosed size={13} className="shrink-0" />
          {draft.root}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Field label={t("workspace.name")}>
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={draft.root.split(/[/\\]/).pop()}
            className={fieldInputFull}
          />
        </Field>

        <Field label={t("workspace.defaultModel")} hint={t("workspace.defaultModelHint")}>
          <select
            value={draft.defaultModelId ?? ""}
            onChange={(e) => set("defaultModelId", e.target.value || undefined)}
            className={fieldInputFull}
          >
            <option value="">{t("workspace.providerDefault", { model: provider.model || t("workspace.unset") })}</option>
            {(provider.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("workspace.isolation")} hint={t("workspace.isolationHint")}>
          <select
            value={draft.isolation}
            onChange={(e) => set("isolation", e.target.value as Workspace["isolation"])}
            className={fieldInputFull}
          >
            <option value="worktree">{t("workspace.worktree")}</option>
            <option value="direct">{t("workspace.direct")}</option>
          </select>
        </Field>

        <Field label={t("workspace.instructions")} hint={t("workspace.instructionsHint")}>
          <textarea
            value={draft.instructions ?? ""}
            onChange={(e) => set("instructions", e.target.value || undefined)}
            rows={3}
            placeholder={t("workspace.instructionsPlaceholder")}
            className={`${fieldInputFull} resize-y`}
          />
        </Field>

        <div className="mt-5">
          <div className="text-sm font-medium text-neutral-700">{t("workspace.tools")}</div>
          <p className="mb-2 text-xs text-neutral-500">{t("workspace.toolsHint")}</p>
          <div className="space-y-1">
            {ALL_TOOLS.map((tool) => (
              <div key={tool} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-neutral-50">
                <span className="text-sm text-neutral-700">{tool}</span>
                <ToolModePicker value={draft.tools[tool]} onChange={(m) => setTool(tool, m)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-neutral-200 px-6 py-3">
        {isNew ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={remove}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={15} /> {t("common.remove")}
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          >
            {isNew ? t("common.add") : t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="text-sm font-medium text-neutral-700">{props.label}</span>
      {props.hint && <span className="mt-0.5 block text-xs text-neutral-500">{props.hint}</span>}
      <div className="mt-1.5">{props.children}</div>
    </label>
  );
}
