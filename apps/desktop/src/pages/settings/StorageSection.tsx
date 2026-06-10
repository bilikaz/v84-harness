// Storage settings: which backend was selected, what the persisted sessions
// occupy, and a per-workspace breakdown so the user can free space by dropping
// a session or a whole workspace's history — informed manual pruning instead of
// an automatic delete policy (the ADR-0012 growth answer).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import { ConfirmActions } from "../../components/ConfirmActions.tsx";
import { deleteSession, useSessions, type Session } from "../../core/sessions/index.ts";
import { useWorkspaces } from "../../core/workspaces.ts";
import { detectStorage } from "../../lib/storage/index.ts";
import { fmtBytes } from "../../lib/format.ts";

// Approximate persisted footprint per session. `bytes` is set by the store at
// persist/migration time (messages json + media blobs); the stringify fallback
// only covers sessions never persisted since the granular tier landed.
function sessionBytes(s: Session): number {
  return s.bytes ?? JSON.stringify(s).length;
}

export function StorageSection() {
  const { t } = useTranslation();
  const sessions = useSessions();
  const workspaces = useWorkspaces();
  const [backend, setBackend] = useState<string>("…");

  useEffect(() => {
    let on = true;
    void detectStorage().then((s) => on && setBackend(s.name));
    return () => {
      on = false;
    };
  }, []);

  const groups: { key: string; name: string; sessions: Session[] }[] = [
    { key: "none", name: t("storage.noWorkspace"), sessions: sessions.filter((s) => !s.workspaceId) },
    ...workspaces.map((w) => ({
      key: w.id,
      name: w.name,
      sessions: sessions.filter((s) => s.workspaceId === w.id),
    })),
  ].filter((g) => g.sessions.length > 0);

  const total = sessions.reduce((n, s) => n + sessionBytes(s), 0);

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("storage.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("storage.subtitle")}</p>

      <div className="mt-4 flex items-center justify-between border-b border-neutral-200 pb-3 text-sm">
        <span className="text-neutral-500">{t("storage.backend")}</span>
        <span className="font-medium text-neutral-800">{t(`storage.backend_${backend}`, { defaultValue: backend })}</span>
      </div>
      <div className="flex items-center justify-between border-b border-neutral-200 py-3 text-sm">
        <span className="text-neutral-500">{t("storage.totalUsed")}</span>
        <span className="font-medium text-neutral-800">{fmtBytes(total)}</span>
      </div>

      {groups.map((g) => (
        <WorkspaceGroup key={g.key} name={g.name} sessions={g.sessions} />
      ))}
    </div>
  );
}

function WorkspaceGroup({ name, sessions }: { name: string; sessions: Session[] }) {
  const { t } = useTranslation();
  const [confirmAll, setConfirmAll] = useState(false);
  const bytes = sessions.reduce((n, s) => n + sessionBytes(s), 0);

  return (
    <section className="mt-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">
          {name} <span className="font-normal text-neutral-400">· {fmtBytes(bytes)}</span>
        </h3>
        {confirmAll ? (
          <ConfirmActions
            className="flex gap-2"
            cancelLabel={t("common.cancel")}
            confirmLabel={t("storage.deleteAll")}
            onCancel={() => setConfirmAll(false)}
            onConfirm={() => {
              setConfirmAll(false);
              sessions.forEach((s) => deleteSession(s.id));
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setConfirmAll(true)}
            className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            {t("storage.deleteAll")}
          </button>
        )}
      </div>
      <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {sessions.map((s) => (
          <div key={s.id} className="group flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-neutral-700">{s.title}</span>
            <span className="shrink-0 text-xs text-neutral-400">{fmtBytes(sessionBytes(s))}</span>
            <button
              type="button"
              onClick={() => deleteSession(s.id)}
              title={t("sidebar.delete")}
              className="shrink-0 rounded-md p-1 text-neutral-300 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
