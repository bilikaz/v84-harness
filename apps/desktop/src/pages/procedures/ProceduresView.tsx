import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Play, Plus, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  createProcedure,
  deleteProcedure,
  saveProcedure,
  useProcedures,
} from "../../lib/procedures.ts";
import { runProcedure } from "../../core/sessions/index.ts";
import { useProvider } from "../../lib/settings.ts";
import { navigate } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";

// Procedures: a library of reusable playbooks (system + user markdown). Running
// one opens a fresh session and executes it against the current provider.
export function ProceduresView() {
  const { t } = useTranslation();
  const procedures = useProcedures();
  const provider = useProvider();
  const [selectedId, setSelectedId] = useState<string | null>(procedures[0]?.id ?? null);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The user message is runtime input — what you paste/type before running, NOT
  // part of the saved playbook. Seeded from the procedure's default template;
  // edits are saved back to the template only while editing.
  const [userInput, setUserInput] = useState("");
  const selected = procedures.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setUserInput(selected?.user ?? "");
    // reset the run input when switching procedures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function select(id: string) {
    setSelectedId(id);
    setConfirmDelete(false);
  }

  function addNew() {
    const id = createProcedure(t("procedures.untitled"));
    setSelectedId(id);
    setConfirmDelete(false);
    setEditing(true); // a fresh procedure opens straight into edit mode
  }

  function doDelete() {
    if (!selected) return;
    const nextId = procedures.find((p) => p.id !== selected.id)?.id ?? null;
    deleteProcedure(selected.id);
    setSelectedId(nextId);
    setConfirmDelete(false);
  }

  function run() {
    if (!selected) return;
    runProcedure({ name: selected.name, system: selected.system, user: userInput }, provider);
    navigate(""); // back to the chat to watch it run
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-6 py-3">
        <h1 className="text-sm font-medium text-neutral-800">{t("procedures.title")}</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
          <div className="flex-1 overflow-y-auto p-2">
            {procedures.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => select(p.id)}
                className={cn(
                  "w-full truncate rounded-lg px-2.5 py-2 text-left text-sm",
                  selectedId === p.id
                    ? "bg-neutral-200/70 text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-200/40",
                )}
              >
                {p.name || t("procedures.untitled")}
              </button>
            ))}
            <button
              type="button"
              onClick={addNew}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-600"
            >
              <Plus size={15} className="shrink-0" />
              {t("procedures.new")}
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
                    onChange={(e) => saveProcedure(selected.id, { name: e.target.value })}
                    placeholder={t("procedures.namePlaceholder")}
                    className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-base font-semibold text-neutral-900 outline-none focus:border-neutral-400"
                  />
                ) : (
                  <h2 className="flex-1 truncate text-lg font-semibold text-neutral-900">
                    {selected.name || t("procedures.untitled")}
                  </h2>
                )}
                <button
                  type="button"
                  onClick={run}
                  className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  <Play size={15} /> {t("procedures.run")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserInput(selected.user); // flip to the saved version
                    setEditing((v) => !v);
                  }}
                  title={t("procedures.edit")}
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
                    title={t("procedures.delete")}
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
                      <p className="text-sm text-neutral-700">{t("procedures.confirmDelete")}</p>
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
                        >
                          {t("procedures.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={doDelete}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
                        >
                          {t("procedures.delete")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Field
                label={t("procedures.system")}
                help={t("procedures.systemHelp")}
                value={selected.system}
                editing={editing}
                onChange={(v) => saveProcedure(selected.id, { system: v })}
                placeholder={t("procedures.systemPlaceholder")}
              />

              {/* User message — runtime input. Always editable; you paste/type
                  here and Run sends it. Edits persist as the default only while
                  editing the playbook. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-neutral-800">{t("procedures.user")}</span>
                <span className="text-xs text-neutral-400">{t("procedures.userHelp")}</span>
                <textarea
                  value={userInput}
                  onChange={(e) => {
                    setUserInput(e.target.value);
                    if (editing) saveProcedure(selected.id, { user: e.target.value });
                  }}
                  placeholder={t("procedures.userPlaceholder")}
                  rows={10}
                  className="resize-y rounded-lg border border-neutral-200 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-neutral-400"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            {t("procedures.empty")}
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
        <div className="prose prose-sm prose-neutral max-w-none rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.value}</ReactMarkdown>
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm text-neutral-400">—</div>
      )}
    </div>
  );
}
