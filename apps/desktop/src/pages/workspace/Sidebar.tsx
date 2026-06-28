import { useEffect, useRef, useState, type ReactNode } from "react";
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

import { InlineEdit } from "../../components/InlineEdit.tsx";
import { Slot } from "../../components/Slot.tsx";
import { cn } from "../../lib/cn.ts";
import { navigate } from "../../lib/router.ts";
import {
  createSession,
  getSessionsForContainer,
  renameSession,
  setActive,
  useActiveId,
  useSessions,
  useStreamingIds,
} from "../../core/sessions/index.ts";
import { useWaiting } from "../../core/runner/index.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import {
  createContainer,
  deleteContainer,
  getContainer,
  updateContainer,
  setActiveContainer,
  useActiveContainerId,
  useContainers,
  type Container,
  type ContainerType,
} from "../../core/containers.ts";
import { isConnected, useAccount } from "../../core/account.ts";
import { useOutsideClick } from "../../lib/hooks.ts";
import { LANGUAGES, setLanguage } from "../../lib/i18n.ts";
import { ContainerSettings } from "./ContainerSettings.tsx";

// Shell sidebar: workspace switcher + workspace-scoped session list + user menu (null workspace = "Chat").
export function Sidebar() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const sessions = useSessions();
  const activeId = useActiveId();
  const streamingIds = useStreamingIds();
  const waiting = useWaiting();
  const containers = useContainers();
  const activeContainerId = useActiveContainerId();
  const account = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  // Which block's rows are in manage mode (rename/delete revealed) — scoped to one block at a time.
  const [editBlock, setEditBlock] = useState<ContainerType | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sessions of one container, grouped: each top-level session with its sub-agent children (depth 1).
  // The children render in a bordered block beside their parent — a thread bracket, not a list-wide rail.
  function sessionTree(containerId: string): { session: (typeof sessions)[number]; children: (typeof sessions)[number][] }[] {
    const list = sessions.filter((s) => s.containerId === containerId);
    const top = list.filter((s) => !s.parentId || !list.some((p) => p.id === s.parentId));
    return top.map((s) => ({ session: s, children: list.filter((c) => c.parentId === s.id) }));
  }

  // Inline rename handles both containers and sessions — branch on which kind the id is.
  function commitRename(id: string) {
    const container = getContainer(id);
    if (container) void updateContainer(id, { name: draft.trim() || container.name });
    else renameSession(id, draft);
    setRenamingId(null);
  }

  function selectContainer(id: string) {
    setActiveContainer(id);
    const first = getSessionsForContainer(id)[0];
    if (first) setActive(first.id);
    else createSession({ containerId: id });
    navigate("");
  }

  async function addChat() {
    const created = await createContainer({ type: "chat", name: t("sidebar.newChat") });
    if (created) selectContainer(created.id);
  }

  async function addLocalWorkspace() {
    const root = ctx.api.pickFolder
      ? await ctx.api.pickFolder()
      : window.prompt("Workspace folder path (the folder picker needs the desktop app):");
    if (!root) return;
    const name = root.split(/[/\\]/).filter(Boolean).pop() ?? "workspace";
    const created = await createContainer({ type: "local", name, config: { root } });
    if (created) selectContainer(created.id);
  }

  // Remote containers live on the server (placement remote), so they need a connection; the
  // VM/Docker backing comes later — for now it's the container concept without execution.
  async function addRemote() {
    const name = window.prompt("Remote workspace name:") ?? "";
    if (!name.trim()) return;
    const created = await createContainer({ type: "remote", name: name.trim() });
    if (created) selectContainer(created.id);
  }

  // Delete a container and cascade to its sessions. Keep at least one container so a session
  // always has a home; the store re-points `active` if the active container is the one removed.
  function removeContainer(id: string) {
    if (containers.length <= 1) return;
    getSessionsForContainer(id).forEach((s) => ctx.sessions.deleteSession(s.id));
    void deleteContainer(id);
  }

  // A container with no sessions gets one opened so the composer targets a session.
  useEffect(() => {
    if (activeContainerId && getSessionsForContainer(activeContainerId).length === 0) {
      createSession({ containerId: activeContainerId });
    }
  }, [activeContainerId, sessions]);

  useOutsideClick(menuOpen, menuRef, () => setMenuOpen(false));

  // Local needs a host filesystem (desktop only — the native folder picker is the signal);
  // Remote needs a connected account (the server holds it). Chat is always available.
  const isDesktop = !!ctx.api.pickFolder;
  const connected = isConnected();
  const blocks: { type: ContainerType; label: string; onAdd: () => unknown }[] = [
    { type: "chat", label: t("sidebar.chats"), onAdd: addChat },
  ];
  if (isDesktop) blocks.push({ type: "local", label: t("sidebar.local"), onAdd: addLocalWorkspace });
  if (connected) blocks.push({ type: "remote", label: t("sidebar.remote"), onAdd: addRemote });

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
      <div className="p-3">
        <Slot region="left-top" />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-2 py-1">
        {blocks.map(({ type, label, onAdd }) => {
          const manage = editBlock === type;
          return (
            <div key={type}>
              <div className="flex items-center justify-between px-2 pb-0.5">
                <span className="text-xs font-medium text-neutral-400">{label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditBlock(manage ? null : type);
                    setRenamingId(null);
                  }}
                  title={t("sidebar.manage")}
                  className={cn("rounded p-0.5 hover:bg-neutral-200/60", manage ? "bg-neutral-200/60 text-neutral-700" : "text-neutral-400")}
                >
                  <SlidersHorizontal size={12} />
                </button>
              </div>

              {containers
                .filter((c) => c.type === type)
                .map((c) => {
                  const selected = activeContainerId === c.id;
                  const sessionRow = (s: (typeof sessions)[number], child: boolean, related = false, threadActive = false) => (
                    <Row
                      key={s.id}
                      icon={null}
                      label={s.title}
                      active={activeId === s.id}
                      related={related}
                      threadActive={threadActive}
                      indent={child}
                      dot={<StatusDot waiting={waiting[s.id] !== undefined} streaming={streamingIds.has(s.id)} unread={!!s.unread} />}
                      renaming={renamingId === s.id}
                      draft={draft}
                      onDraft={setDraft}
                      onCommit={() => commitRename(s.id)}
                      onCancelRename={() => setRenamingId(null)}
                      onSelect={() => {
                        setActive(s.id);
                        navigate("");
                      }}
                      onRename={manage ? () => { setRenamingId(s.id); setDraft(s.title); } : undefined}
                      onDelete={manage ? () => ctx.sessions.deleteSession(s.id) : undefined}
                    />
                  );
                  return (
                    <div key={c.id}>
                      <Row
                        icon={iconForType(c.type)}
                        label={c.name}
                        active={selected}
                        renaming={renamingId === c.id}
                        draft={draft}
                        onDraft={setDraft}
                        onCommit={() => commitRename(c.id)}
                        onCancelRename={() => setRenamingId(null)}
                        onSelect={() => selectContainer(c.id)}
                        onRename={manage ? () => { setRenamingId(c.id); setDraft(c.name); } : undefined}
                        onSettings={manage ? () => setSettingsId(c.id) : undefined}
                        onDelete={manage && containers.length > 1 ? () => removeContainer(c.id) : undefined}
                      />
                      {/* Selected container expands to show its sessions; sub-agent children get a thread bracket. */}
                      {selected && (
                        <div className="ml-3 pl-1">
                          {sessionTree(c.id).map(({ session: s, children }) => (
                            <div key={s.id}>
                              {sessionRow(s, false, children.length > 0, children.some((ch) => ch.id === activeId))}
                              {children.length > 0 && (
                                <div className="ml-2 border-l border-neutral-300 pl-1">
                                  {children.map((ch) => sessionRow(ch, true))}
                                </div>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              createSession({ containerId: c.id });
                              navigate("");
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-600"
                          >
                            <Plus size={13} className="shrink-0" />
                            <span className="truncate">{t("sidebar.newSession")}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

              <button
                type="button"
                onClick={() => void onAdd()}
                className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-600"
              >
                <Plus size={14} className="shrink-0" />
                <span className="truncate">{t("sidebar.add")}</span>
              </button>
            </div>
          );
        })}
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

      {settingsId && getContainer(settingsId) && (
        <ContainerSettings
          container={getContainer(settingsId) as Container}
          onClose={() => setSettingsId(null)}
          onDelete={() => removeContainer(settingsId)}
        />
      )}
    </aside>
  );
}

function iconForType(type: ContainerType): typeof FolderClosed {
  return type === "chat" ? MessageSquare : type === "remote" ? Globe : FolderClosed;
}

// One sidebar row — a container or a session. Inline-renames when `renaming`; reveals
// rename/settings/delete actions when the handlers are provided (manage mode).
function Row(props: {
  icon: typeof FolderClosed | null;
  label: string;
  active: boolean;
  related?: boolean; // a parent that has sub-agents — softly highlighted so it reads as a block header
  threadActive?: boolean; // a parent whose active child makes the whole thread read as active
  indent?: boolean;
  dot?: ReactNode;
  renaming?: boolean;
  draft?: string;
  onDraft?: (v: string) => void;
  onCommit?: () => void;
  onCancelRename?: () => void;
  onSelect: () => void;
  onRename?: () => void;
  onSettings?: () => void;
  onDelete?: () => void;
}) {
  const { icon: Icon, label, active, related, threadActive, indent, dot, renaming, draft, onDraft, onCommit, onCancelRename } = props;
  const { onSelect, onRename, onSettings, onDelete } = props;
  const { t } = useTranslation();

  if (renaming) {
    return (
      <InlineEdit
        value={draft ?? ""}
        onChange={(v) => onDraft?.(v)}
        onCommit={() => onCommit?.()}
        onCancel={() => onCancelRename?.()}
        className={cn("my-1 min-w-0 bg-white px-2 py-1")}
      />
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-0.5 rounded-lg pr-1",
        active || threadActive ? "bg-[#666]" : related ? "bg-neutral-200/70" : "hover:bg-neutral-200/40",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left text-sm",
          indent && "py-1",
          active || threadActive ? "text-white" : "text-neutral-600",
        )}
      >
        {dot}
        {Icon && <Icon size={15} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </button>
      {onRename && (
        <button type="button" onClick={onRename} title={t("sidebar.rename")} className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700">
          <Pencil size={13} />
        </button>
      )}
      {onSettings && (
        <button type="button" onClick={onSettings} title={t("container.title")} className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700">
          <Settings size={13} />
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} title={t("sidebar.delete")} className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-red-100 hover:text-red-600">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function StatusDot({ waiting, streaming, unread }: { waiting: boolean; streaming: boolean; unread: boolean }) {
  const { t } = useTranslation();
  // The dot is the only cue for these states — label it so it's not a silent <span> to a screen reader.
  const label = waiting ? t("sidebar.waitingSlot") : streaming ? t("sidebar.streaming") : unread ? t("sidebar.unread") : undefined;
  return (
    <span
      title={label}
      aria-label={label}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        waiting ? "animate-pulse bg-sky-400" : streaming ? "animate-pulse bg-amber-400" : unread ? "bg-emerald-500" : "bg-transparent",
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
