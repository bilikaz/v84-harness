import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { Modal } from "../../components/Modal.tsx";
import { ConfirmActions } from "../../components/ConfirmActions.tsx";
import { ToolModePicker } from "../../components/ToolModePicker.tsx";
import { fieldInputFull } from "../settings/Field.tsx";
import { updateContainer, type Container } from "../../core/containers.ts";
import { type ToolName, type ToolPermission } from "../../core/tools/types.ts";
import { useGatedTools } from "../../renderer/gatedTools.ts";

type Perms = Record<ToolName, ToolPermission>;

// Container editor (the gear on a container row). Rename + type-specific config + the per-tool
// permission ceiling (stored as container.permissions; only meaningful for workspace containers).
// Delete is the caller's cascade (it also removes the container's sessions), passed as onDelete.
export function ContainerSettings(props: { container: Container; onClose: () => void; onDelete: () => void }) {
  const { container, onClose, onDelete } = props;
  const { t } = useTranslation();
  const gatedTools = useGatedTools();
  const [tab, setTab] = useState<"settings" | "other">("settings");
  const [name, setName] = useState(container.name);
  const [root, setRoot] = useState(String(container.config.root ?? ""));
  const [instructions, setInstructions] = useState(String(container.config.instructions ?? ""));
  const [perms, setPerms] = useState<Perms>({ ...(container.permissions as Perms) });
  const [confirm, setConfirm] = useState(false);
  const isWorkspace = container.type !== "chat";

  function save() {
    const config: Record<string, unknown> = { ...container.config, instructions: instructions.trim() || undefined };
    if (container.type === "local") config.root = root.trim();
    void updateContainer(container.id, { name: name.trim() || container.name, permissions: perms, config });
    onClose();
  }

  return (
    <Modal open onClose={onClose} className="flex max-h-[88vh] w-[min(760px,94vw)] flex-col overflow-hidden">
      <div className="border-b border-neutral-200 px-6 pt-4">
        <h2 className="text-lg font-semibold text-neutral-900">{t("container.title")}</h2>
        <div className="mt-3 flex gap-1">
          {(["settings", "other"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                "rounded-t-md border-b-2 px-3 py-1.5 text-sm " +
                (tab === id ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-800")
              }
            >
              {t(id === "settings" ? "container.tabSettings" : "container.tabOther")}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {tab === "settings" ? (
          <>
            <label className="block text-sm font-medium text-neutral-700">{t("container.name")}</label>
            <input className={fieldInputFull} value={name} onChange={(e) => setName(e.target.value)} autoFocus />

            {container.type === "local" && (
              <>
                <label className="mt-3 block text-sm font-medium text-neutral-700">{t("container.root")}</label>
                <input className={fieldInputFull} value={root} onChange={(e) => setRoot(e.target.value)} />
              </>
            )}

            {isWorkspace && (
              <div className="mt-5">
                <div className="text-sm font-medium text-neutral-700">{t("container.tools")}</div>
                <p className="mb-2 text-xs text-neutral-500">{t("container.toolsHint")}</p>
                <div className="grid grid-cols-2 gap-x-5 gap-y-1">
                  {gatedTools.map((d) => (
                    <div key={d.name} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
                      <span className="truncate text-sm text-neutral-700">{d.name}</span>
                      <ToolModePicker
                        value={perms[d.name] ?? d.defaultMode}
                        onChange={(m) => setPerms((p) => ({ ...p, [d.name]: m }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="block text-sm font-medium text-neutral-700">{t("container.systemPrompt")}</label>
            <p className="mb-2 text-xs text-neutral-500">{t("container.systemPromptHint")}</p>
            <textarea
              className={fieldInputFull + " min-h-[220px] resize-y font-mono text-xs leading-relaxed"}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t("container.systemPromptPlaceholder")}
            />
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-neutral-200 px-6 py-3">
        {confirm ? (
          <ConfirmActions
            className="flex gap-2"
            cancelLabel={t("common.cancel")}
            confirmLabel={t("container.delete")}
            onCancel={() => setConfirm(false)}
            onConfirm={() => {
              onDelete();
              onClose();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={15} /> {t("container.delete")}
          </button>
        )}
        <button type="button" onClick={save} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
          {t("common.save")}
        </button>
      </div>
    </Modal>
  );
}
