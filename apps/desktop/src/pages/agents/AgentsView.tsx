import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Play, Plus, Trash2 } from "lucide-react";

import { AttachmentList } from "../../components/AttachmentList.tsx";
import { ConfirmActions } from "../../components/ConfirmActions.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { buildValidator, createAgent, deleteAgent, saveAgent, useAgents } from "../../core/agents.ts";
import { runAgent } from "../../core/sessions/index.ts";
import { readAttachments } from "../../lib/attachments.ts";
import { useProvider } from "../../core/settings.ts";
import { navigate } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";
import type { FileAttachment, ImageRef } from "../../lib/types.ts";

// Agents: a library of reusable playbooks (name + description + system/user
// markdown). Running one opens a fresh session and executes it against the
// current provider. The description is a short summary used both here and by
// the upcoming "run agent" tool so agents can orchestrate one another.
export function AgentsView() {
  const { t } = useTranslation();
  const agents = useAgents();
  const provider = useProvider();
  const [selectedId, setSelectedId] = useState<string | null>(agents[0]?.id ?? null);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The user message is runtime input — what you paste/type before running, NOT
  // part of the saved playbook. Seeded from the agent's default template; edits
  // are saved back to the template only while editing. Images/files are runtime
  // input too: attached for this run, never saved to the playbook.
  const [userInput, setUserInput] = useState("");
  const [images, setImages] = useState<ImageRef[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = agents.find((a) => a.id === selectedId) ?? null;

  useEffect(() => {
    setUserInput(selected?.user ?? "");
    setImages([]);
    setFiles([]);
    // reset the run input when switching agents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function select(id: string) {
    setSelectedId(id);
    setConfirmDelete(false);
  }

  function addNew() {
    const id = createAgent(t("agents.untitled"));
    setSelectedId(id);
    setConfirmDelete(false);
    setEditing(true); // a fresh agent opens straight into edit mode
  }

  function doDelete() {
    if (!selected) return;
    const nextId = agents.find((a) => a.id !== selected.id)?.id ?? null;
    deleteAgent(selected.id);
    setSelectedId(nextId);
    setConfirmDelete(false);
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    if (el.files?.length) {
      const { images: imgs, files: fs } = await readAttachments(el.files);
      if (imgs.length) setImages((prev) => [...prev, ...imgs]);
      if (fs.length) setFiles((prev) => [...prev, ...fs]);
    }
    el.value = ""; // allow re-picking the same file
  }

  function run() {
    if (!selected) return;
    runAgent(
      { name: selected.name, system: selected.system, user: userInput },
      provider,
      {
        images: images.length ? images : undefined,
        files: files.length ? files : undefined,
        validate: buildValidator(selected.output),
      },
    );
    navigate(""); // back to the chat to watch it run
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-6 py-3">
        <h1 className="text-sm font-medium text-neutral-800">{t("agents.title")}</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
          <div className="flex-1 overflow-y-auto p-2">
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => select(a.id)}
                className={cn(
                  "w-full truncate rounded-lg px-2.5 py-2 text-left text-sm",
                  selectedId === a.id
                    ? "bg-neutral-200/70 text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-200/40",
                )}
              >
                {a.name || t("agents.untitled")}
              </button>
            ))}
            <button
              type="button"
              onClick={addNew}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-600"
            >
              <Plus size={15} className="shrink-0" />
              {t("agents.new")}
            </button>
          </div>
        </div>

        {/* Editor */}
        {selected ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              <div className="flex items-center gap-3">
                {editing ? (
                  <input
                    value={selected.name}
                    onChange={(e) => saveAgent(selected.id, { name: e.target.value })}
                    placeholder={t("agents.namePlaceholder")}
                    className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-base font-semibold text-neutral-900 outline-none focus:border-neutral-400"
                  />
                ) : (
                  <h2 className="flex-1 truncate text-lg font-semibold text-neutral-900">
                    {selected.name || t("agents.untitled")}
                  </h2>
                )}
                <button
                  type="button"
                  onClick={run}
                  className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  <Play size={15} /> {t("agents.run")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserInput(selected.user); // flip to the saved version
                    setEditing((v) => !v);
                  }}
                  title={t("agents.edit")}
                  className={cn(
                    "rounded-lg p-2",
                    editing
                      ? "bg-neutral-200 text-neutral-800"
                      : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700",
                  )}
                >
                  <Pencil size={16} />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete((v) => !v)}
                    title={t("agents.delete")}
                    className={cn(
                      "rounded-lg p-2",
                      confirmDelete
                        ? "bg-red-50 text-red-600"
                        : "text-neutral-400 hover:bg-neutral-100 hover:text-red-600",
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
              </div>

              {/* Description — short summary of what this agent does. Shown when
                  editing; otherwise rendered under the title as muted text. */}
              {editing ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-neutral-800">{t("agents.description")}</span>
                  <span className="text-xs text-neutral-400">{t("agents.descriptionHelp")}</span>
                  <textarea
                    value={selected.description}
                    onChange={(e) => saveAgent(selected.id, { description: e.target.value })}
                    placeholder={t("agents.descriptionPlaceholder")}
                    rows={2}
                    className="resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-neutral-400"
                  />
                </div>
              ) : (
                selected.description && <p className="text-sm text-neutral-500">{selected.description}</p>
              )}

              <Field
                label={t("agents.system")}
                help={t("agents.systemHelp")}
                value={selected.system}
                editing={editing}
                onChange={(v) => saveAgent(selected.id, { system: v })}
                placeholder={t("agents.systemPlaceholder")}
              />

              {/* User message — runtime input. Always editable; you paste/type
                  here and Run sends it. Edits persist as the default only while
                  editing the playbook. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-neutral-800">{t("agents.user")}</span>
                <span className="text-xs text-neutral-400">{t("agents.userHelp")}</span>
                <textarea
                  value={userInput}
                  onChange={(e) => {
                    setUserInput(e.target.value);
                    if (editing) saveAgent(selected.id, { user: e.target.value });
                  }}
                  placeholder={t("agents.userPlaceholder")}
                  rows={10}
                  className="resize-y rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400"
                />

                {/* Attachments for this run — images preview as thumbnails,
                    other files as chips. Not saved to the playbook. */}
                <AttachmentList
                  images={images}
                  files={files}
                  onRemoveImage={(i) => setImages((prev) => prev.filter((_, j) => j !== i))}
                  onRemoveFile={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
                />
                <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                >
                  <Plus size={14} /> {t("agents.attach")}
                </button>
              </div>

              {/* Output contract — when on, the chat engine validates this
                  agent's final answer and heals (re-prompts) on failure. Only
                  editable; it's part of the saved playbook. */}
              {editing && (
                <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                    <input
                      type="checkbox"
                      checked={!!selected.output?.json}
                      onChange={(e) =>
                        saveAgent(selected.id, {
                          output: e.target.checked
                            ? { json: true, required: selected.output?.required }
                            : undefined,
                        })
                      }
                    />
                    {t("agents.requireJson")}
                  </label>
                  <span className="text-xs text-neutral-400">{t("agents.outputHelp")}</span>
                  {selected.output?.json && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-neutral-700">{t("agents.requiredKeys")}</span>
                      <input
                        value={(selected.output.required ?? []).join(", ")}
                        onChange={(e) =>
                          saveAgent(selected.id, {
                            output: {
                              json: true,
                              required: e.target.value
                                .split(/[,\n]/)
                                .map((s) => s.trim())
                                .filter(Boolean),
                            },
                          })
                        }
                        placeholder={t("agents.requiredKeysPlaceholder")}
                        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
                      />
                      <span className="text-xs text-neutral-400">{t("agents.requiredKeysHelp")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            {t("agents.empty")}
          </div>
        )}
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  help: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-neutral-800">{props.label}</span>
      {props.editing && <span className="text-xs text-neutral-400">{props.help}</span>}
      {props.editing ? (
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          rows={props.rows ?? 6}
          className="resize-y rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400"
        />
      ) : props.value ? (
        <Markdown text={props.value} className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2" />
      ) : (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm text-neutral-400">—</div>
      )}
    </div>
  );
}
