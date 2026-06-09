import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  FolderClosed,
  Globe,
  MessageSquare,
  Pencil,
  Plus,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Slot } from "../../components/Slot.tsx";
import { cn } from "../../lib/cn.ts";
import { navigate } from "../../lib/router.ts";
import {
  createSession,
  deleteSession,
  getSessionsForWorkspace,
  renameSession,
  setActive,
  useActiveId,
  useSessions,
  useStreamingIds,
} from "../../core/sessions/index.ts";
import {
  defaultWorkspace,
  setActiveWorkspace,
  useActiveWorkspaceId,
  useWorkspaces,
  type Workspace,
} from "../../core/workspaces.ts";
import { harness } from "../../lib/harness.ts";
import { useAccount } from "../../lib/account.ts";
import { LANGUAGES, setLanguage } from "../../lib/i18n.ts";
import { WorkspaceSettings } from "./WorkspaceSettings.tsx";

// Shell sidebar: brand (left-top slot), the WORKSPACES switcher, the SESSIONS
// list scoped to the selected workspace, and the user menu. Selecting a
// workspace scopes the session list; "+ New session" binds the new session to
// the selected workspace (null = the "Chat" / no-workspace group).
export function Sidebar() {
  const { t } = useTranslation();
  const sessions = useSessions();
  const activeId = useActiveId();
  const streamingIds = useStreamingIds();
  const workspaces = useWorkspaces();
  const activeWorkspaceId = useActiveWorkspaceId();
  const account = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ ws: Workspace; isNew: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visibleSessions = sessions.filter((s) => (s.workspaceId ?? null) === activeWorkspaceId);

  function commitRename(id: string) {
    renameSession(id, draft);
    setRenamingId(null);
  }

  function selectWorkspace(id: string | null) {
    setActiveWorkspace(id);
    const first = getSessionsForWorkspace(id)[0];
    if (first) setActive(first.id);
    else if (id !== null) createSession({ workspaceId: id }); // open a session bound to the workspace
    navigate("");
  }

  async function addWorkspace() {
    const root = harness
      ? await harness.pickFolder()
      : window.prompt("Workspace folder path (the folder picker needs the desktop app):");
    if (!root) return;
    const name = root.split(/[/\\]/).filter(Boolean).pop() ?? "workspace";
    setEditing({ ws: defaultWorkspace(root, name), isNew: true });
  }

  // Keep a workspace from stranding you in a different session: whenever the
  // active workspace has no sessions (e.g. just added), open one bound to it so
  // the composer targets a tool-enabled session.
  useEffect(() => {
    if (activeWorkspaceId && getSessionsForWorkspace(activeWorkspaceId).length === 0) {
      createSession({ workspaceId: activeWorkspaceId });
    }
  }, [activeWorkspaceId, sessions]);

  // Close the user menu when clicking anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
      <div className="p-3">
        <Slot region="left-top" />
      </div>

      {/* Workspaces switcher */}
      <div className="px-2">
        <div className="px-2 pb-1 text-xs font-medium text-neutral-400">Workspaces</div>
        <WorkspaceRow
          icon={MessageSquare}
          label="Chat"
          active={activeWorkspaceId === null}
          onSelect={() => selectWorkspace(null)}
        />
        {workspaces.map((w) => (
          <WorkspaceRow
            key={w.id}
            icon={FolderClosed}
            label={w.name}
            active={activeWorkspaceId === w.id}
            onSelect={() => selectWorkspace(w.id)}
            onSettings={() => setEditing({ ws: w, isNew: false })}
          />
        ))}
        <button
          type="button"
          onClick={() => void addWorkspace()}
          className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-600"
        >
          <Plus size={15} className="shrink-0" />
          <span className="truncate">Add workspace</span>
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between px-4 pb-1">
        <span className="text-xs font-medium text-neutral-400">{t("sidebar.sessions")}</span>
        <button
          type="button"
          onClick={() => {
            setEditMode((v) => !v);
            setRenamingId(null);
          }}
          title={t("sidebar.manage")}
          className={cn(
            "rounded p-1 hover:bg-neutral-200/60",
            editMode ? "bg-neutral-200/60 text-neutral-700" : "text-neutral-400",
          )}
        >
          <SlidersHorizontal size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {visibleSessions.map((s) => {
          const renaming = renamingId === s.id;
          return (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-0.5 rounded-lg pr-1",
                activeId === s.id ? "bg-neutral-200/70" : "hover:bg-neutral-200/40",
              )}
            >
              {renaming ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id);
                    else if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => commitRename(s.id)}
                  className="my-1 min-w-0 flex-1 rounded-md bg-white px-2 py-1 text-sm outline-none ring-1 ring-neutral-300"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setActive(s.id);
                    navigate(""); // leave Agents/Settings → back to the chat
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm",
                    activeId === s.id ? "text-neutral-900" : "text-neutral-600",
                  )}
                >
                  <StatusDot streaming={streamingIds.has(s.id)} unread={!!s.unread} />
                  <span className="truncate">{s.title}</span>
                </button>
              )}

              {editMode && !renaming && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(s.id);
                      setDraft(s.title);
                    }}
                    title={t("sidebar.rename")}
                    className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSession(s.id)}
                    title={t("sidebar.delete")}
                    className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-red-100 hover:text-red-600"
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            createSession({ workspaceId: activeWorkspaceId });
            navigate("");
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-600"
        >
          <Plus size={15} className="shrink-0" />
          <span className="truncate">{t("sidebar.newSession")}</span>
        </button>
      </div>

      <div ref={menuRef} className="relative border-t border-neutral-200 p-2">
        {menuOpen && <UserMenu onClose={() => setMenuOpen(false)} />}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-200/50"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-base">
            {account.avatar}
          </span>
          <span className="flex-1 truncate text-neutral-800">{account.username}</span>
          <ChevronDown size={15} className="text-neutral-400" />
        </button>
      </div>

      {editing && (
        <WorkspaceSettings
          key={editing.ws.id}
          workspace={editing.ws}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
        />
      )}
    </aside>
  );
}

// A workspace row: select on click, with a settings gear on hover (workspaces
// only — the "Chat" pseudo-row has no settings).
function WorkspaceRow(props: {
  icon: typeof FolderClosed;
  label: string;
  active: boolean;
  onSelect: () => void;
  onSettings?: () => void;
}) {
  const { icon: Icon, label, active, onSelect, onSettings } = props;
  return (
    <div
      className={cn(
        "group flex items-center gap-0.5 rounded-lg pr-1",
        active ? "bg-neutral-200/70" : "hover:bg-neutral-200/40",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left text-sm",
          active ? "text-neutral-900" : "text-neutral-600",
        )}
      >
        <Icon size={15} className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {onSettings && (
        <button
          type="button"
          onClick={onSettings}
          title="Workspace settings"
          className="shrink-0 rounded-md p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100"
        >
          <Settings size={13} />
        </button>
      )}
    </div>
  );
}

// streaming → yellow, finished-but-unread → green, read/idle → transparent.
function StatusDot({ streaming, unread }: { streaming: boolean; unread: boolean }) {
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        streaming ? "animate-pulse bg-amber-400" : unread ? "bg-emerald-500" : "bg-transparent",
      )}
    />
  );
}

function UserMenu({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100";
  return (
    <div className="absolute bottom-14 left-2 right-2 z-20 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
      <button
        type="button"
        className={item}
        onClick={() => {
          onClose();
          navigate("settings/account");
        }}
      >
        <Settings size={16} /> {t("menu.settings")}
      </button>

      <button type="button" className={item} onClick={() => setLangOpen((v) => !v)}>
        <Globe size={16} /> {t("menu.language")}
        <ChevronDown size={14} className={cn("ml-auto text-neutral-400 transition-transform", langOpen && "rotate-180")} />
      </button>
      {langOpen &&
        LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={cn(item, "pl-9")}
            onClick={() => setLanguage(l.code)}
          >
            {l.label}
            {i18n.language === l.code && <Check size={15} className="ml-auto text-neutral-900" />}
          </button>
        ))}
    </div>
  );
}
