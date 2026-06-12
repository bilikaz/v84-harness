import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, PanelRight, Pencil, RefreshCw, Trash2 } from "lucide-react";

import {
  contextLimit,
  deleteSession,
  isFull,
  renameSession,
  send,
  setActive,
  stopTurn,
  useActiveSession,
  useChildRuns,
  useCompacting,
  useSessions,
  useStreaming,
} from "../../core/sessions/index.ts";
import { getAgent } from "../../core/agents.ts";
import { useProvider } from "../../core/settings.ts";
import { useOutsideClick } from "../../lib/hooks.ts";
import { fmtTokens } from "../../lib/format.ts";
import { toggleRightPanel, useRightPanel } from "../../lib/ui.ts";
import { InlineEdit } from "../../components/InlineEdit.tsx";
import { Composer, type ComposerAttachments } from "./Composer.tsx";
import { Message } from "./Message.tsx";
import { SystemBanner } from "./SystemBanner.tsx";
import { cn } from "../../lib/cn.ts";
import type { MediaRef } from "../../lib/types.ts";

// Main center pane: active session transcript + composer.
export function SessionView() {
  const { t } = useTranslation();
  const session = useActiveSession();
  const streaming = useStreaming();
  const compacting = useCompacting();
  const provider = useProvider();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const headerRef = useRef<HTMLDivElement>(null);
  const rightPanel = useRightPanel();
  const full = isFull(provider, session);

  const ctxLimit = contextLimit(provider);
  const used = session.usedTokens ?? 0;

  // The session's stamped system prompt is what runs — the agent may be edited/deleted later.
  const agentName = session.agentId ? (getAgent(session.agentId)?.name ?? session.title) : null;

  // Child run: no composer/stop — control lives in the parent (its Stop cascades here).
  const sessions = useSessions();
  const parent = sessions.find((s) => s.id === session.parentId);
  const isChildRun = !!session.parentId;

  // toolChildren merges live links (in-flight childRuns) with settled ones (tool-result messages).
  const childRuns = useChildRuns();
  const { toolResults, toolImages, toolVideo, toolChildren } = useMemo(() => {
    const toolResults = new Map<string, string>();
    const toolImages = new Map<string, MediaRef[]>();
    const toolVideo = new Map<string, MediaRef[]>();
    const toolChildren = new Map<string, string[]>(Object.entries(childRuns));
    for (const m of session.messages) {
      if (m.role === "tool" && m.toolCallId) {
        toolResults.set(m.toolCallId, m.text);
        if (m.images?.length) toolImages.set(m.toolCallId, m.images);
        if (m.video?.length) toolVideo.set(m.toolCallId, m.video);
        if (m.childSessionIds?.length) toolChildren.set(m.toolCallId, m.childSessionIds);
      }
    }
    return { toolResults, toolImages, toolVideo, toolChildren };
  }, [session.messages, childRuns]);

  useOutsideClick(menuOpen, headerRef, () => setMenuOpen(false));

  // Transcript scrolling: follow streaming only while pinned to bottom; restore per-chat position on switch.
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const positionsRef = useRef<Record<string, number>>({});
  const BOTTOM_PX = 80; // "at bottom" tolerance

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    positionsRef.current[session.id] = el.scrollTop;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_PX;
  }

  // Restore scroll position on chat switch (before paint, to avoid a flash).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = positionsRef.current[session.id];
    el.scrollTop = saved ?? el.scrollHeight; // unseen chat → bottom
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [session.messages]);

  function startRename() {
    setTitleDraft(session.title);
    setRenaming(true);
    setMenuOpen(false);
  }
  function commitRename() {
    renameSession(session.id, titleDraft);
    setRenaming(false);
  }

  function submit(text: string, atts: ComposerAttachments) {
    void send(text, atts);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-6 py-3">
        <div ref={headerRef} className="relative">
          {renaming ? (
            <InlineEdit
              value={titleDraft}
              onChange={setTitleDraft}
              onCommit={commitRename}
              onCancel={() => setRenaming(false)}
              className="px-1.5 py-0.5 font-medium text-neutral-800"
            />
          ) : (
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-neutral-100"
            >
              <span className="text-sm font-medium text-neutral-800">{session.title}</span>
              <ChevronDown size={15} className="text-neutral-400" />
            </button>
          )}

          {menuOpen && (
            <div className="absolute left-0 top-9 z-20 w-44 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-xl">
              <button
                type="button"
                onClick={startRename}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100"
              >
                <Pencil size={15} /> {t("sidebar.rename")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  deleteSession(session.id);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={15} /> {t("sidebar.delete")}
              </button>
            </div>
          )}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggleRightPanel}
          title={rightPanel ? t("session.hidePanel") : t("session.showPanel")}
          className={cn(
            "rounded-md p-1.5 hover:bg-neutral-100",
            rightPanel ? "text-neutral-700" : "text-neutral-400",
          )}
        >
          <PanelRight size={18} />
        </button>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {agentName !== null && <SystemBanner name={agentName} system={session.system} />}
          {session.loaded === false && (
            <p className="flex items-center justify-center gap-1.5 py-8 text-xs text-neutral-400">
              <RefreshCw size={12} className="animate-spin" /> {t("session.loading")}
            </p>
          )}
          {session.messages.map((m, i) =>
            // Tool results fold into the assistant's tool card; summaries/heal corrections are model-only.
            m.role === "tool" || m.summary || m.hidden ? null : (
              <Message
                key={m.id}
                role={m.role}
                text={m.text}
                thinking={m.thinking}
                images={m.images}
                video={m.video}
                files={m.files}
                toolCalls={m.toolCalls}
                results={toolResults}
                toolImages={toolImages}
                toolVideo={toolVideo}
                toolChildren={toolChildren}
                streaming={streaming && i === session.messages.length - 1}
              />
            ),
          )}
        </div>
      </div>

      <div className="px-6 pb-6">
        {isChildRun ? (
          // Deleting removes only this run log — the answer survives in the parent's tool result.
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
            <span className="px-1 text-xs text-neutral-500">{t("agents.childRun")}</span>
            {parent && (
              <button
                type="button"
                onClick={() => setActive(parent.id)}
                className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              >
                {t("agents.toParent", { title: parent.title })}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                // Capture parent id before the delete switches the active session.
                const pid = parent?.id;
                deleteSession(session.id);
                if (pid) setActive(pid);
              }}
              className="flex items-center gap-1.5 rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 size={12} /> {t("agents.deleteRun")}
            </button>
          </div>
        ) : (
          <>
            {compacting ? (
              <p className="mx-auto mb-2 flex max-w-3xl items-center justify-center gap-1.5 text-center text-xs text-neutral-500">
                <RefreshCw size={12} className="animate-spin" /> {t("session.compacting")}
              </p>
            ) : full ? (
              <p className="mx-auto mb-2 max-w-3xl text-center text-xs text-red-600">
                {t("session.contextFull", {
                  used: fmtTokens(used),
                  total: fmtTokens(ctxLimit),
                })}
              </p>
            ) : null}
            <Composer
              disabled={compacting || full}
              streaming={streaming}
              onStop={() => stopTurn(session.id)}
              onSubmit={submit}
            />
          </>
        )}
      </div>
    </div>
  );
}
