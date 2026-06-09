import { useState, type ReactNode } from "react";
import { FolderClosed, Trash2 } from "lucide-react";

import { Modal } from "../../components/Modal.tsx";
import { cn } from "../../lib/cn.ts";
import { useProvider } from "../../lib/settings.ts";
import {
  addWorkspace,
  deleteWorkspace,
  updateWorkspace,
  type Workspace,
} from "../../core/workspaces.ts";
import { ALL_TOOLS, type GatedTool, type ToolMode } from "../../core/tools/shared.ts";

// Add/edit popup for a workspace. Opened from the sidebar after the folder
// picker (new) or from a workspace row (edit). Self-contained form over a local
// copy of the draft; Save commits to the store.
const MODES: { value: ToolMode; label: string; hint: string }[] = [
  { value: 0, label: "Off", hint: "withheld from the agent" },
  { value: 1, label: "Ask", hint: "asks before each call" },
  { value: 2, label: "Auto", hint: "runs without asking" },
];

export function WorkspaceSettings(props: { workspace: Workspace; isNew: boolean; onClose: () => void }) {
  const { workspace, isNew, onClose } = props;
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
        <h2 className="text-lg font-semibold text-neutral-900">{isNew ? "Add workspace" : "Workspace settings"}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-500">
          <FolderClosed size={13} className="shrink-0" />
          {draft.root}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Field label="Name">
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={draft.root.split(/[/\\]/).pop()}
            className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
        </Field>

        <Field label="Default model" hint="Model new sessions in this workspace use.">
          <select
            value={draft.defaultModelId ?? ""}
            onChange={(e) => set("defaultModelId", e.target.value || undefined)}
            className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          >
            <option value="">Provider default ({provider.model || "unset"})</option>
            {(provider.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Isolation" hint="A git worktree per session keeps parallel agents from clobbering files.">
          <select
            value={draft.isolation}
            onChange={(e) => set("isolation", e.target.value as Workspace["isolation"])}
            className="w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          >
            <option value="worktree">Worktree per session</option>
            <option value="direct">Work directly in the folder</option>
          </select>
        </Field>

        <Field label="Instructions" hint="Optional standing system prompt for agents in this workspace.">
          <textarea
            value={draft.instructions ?? ""}
            onChange={(e) => set("instructions", e.target.value || undefined)}
            rows={3}
            placeholder="e.g. This is a pnpm monorepo; run typecheck before finishing."
            className="w-full resize-y rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
        </Field>

        <div className="mt-5">
          <div className="text-sm font-medium text-neutral-700">Tools</div>
          <p className="mb-2 text-xs text-neutral-500">
            File tools are confined to this folder; only Bash can step outside, so it asks by default.
          </p>
          <div className="space-y-1">
            {ALL_TOOLS.map((tool) => (
              <div key={tool} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-neutral-50">
                <span className="text-sm text-neutral-700">{tool}</span>
                <Segmented value={draft.tools[tool]} onChange={(m) => setTool(tool, m)} />
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
            <Trash2 size={15} /> Remove
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          >
            {isNew ? "Add" : "Save"}
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

function Segmented(props: { value: ToolMode; onChange: (m: ToolMode) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-neutral-200">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={m.hint}
          onClick={() => props.onChange(m.value)}
          className={cn(
            "px-2.5 py-1 text-xs",
            props.value === m.value
              ? "bg-neutral-900 text-white"
              : "bg-white text-neutral-600 hover:bg-neutral-100",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
