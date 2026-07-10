import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, PanelRight, Pencil, RefreshCw, Trash2 } from "lucide-react";

import {
  contextLimit,
  getLastSystem,
  isFull,
  lastSummaryIndex,
  renameSession,
  setActive,
  useActiveSession,
  useChildRuns,
  useCompacting,
  useRunnerState,
  useSessions,
  useStreaming,
} from "../../core/sessions/index.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import { getAgent } from "../../core/agents.ts";
import { baseSystemFor, fullSystemFor } from "../../core/sessions/system.ts";
import { useProvider } from "../../core/settings.ts";
import { useOutsideClick } from "../../lib/hooks.ts";
import { fmtTokens } from "../../lib/format.ts";
import { toggleRightPanel, useRightPanel } from "../../core/ui.ts";
import { InlineEdit } from "../../components/InlineEdit.tsx";
import { Composer } from "./Composer.tsx";
import type { Attachments } from "../../core/sessions/index.ts";
import { Message } from "./Message.tsx";
import { SystemBanner } from "./SystemBanner.tsx";
import { cn } from "../../lib/cn.ts";
import type { Image, Video } from "../../lib/types.ts";

// Main center pane: active session transcript + composer.
export function SessionView() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const session = useActiveSession();
  const streaming = useStreaming();
  const runner = useRunnerState(session.id);
  const compacting = useCompacting();
  const provider = useProvider();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const headerRef = useRef<HTMLDivElement>(null);
  const rightPanel = useRightPanel();
  const full = isFull(provider, session);

  const ctxLimit = contextLimit(provider);
  const used = session.meta.usedTokens ?? 0;

  // The session's stamped system prompt is what runs — the agent may be edited/deleted later.
  const agentName = session.agentId ? (getAgent(session.agentId)?.name ?? session.title) : null;

  // The banner shows the FULL prompt the model receives: the live capture of the last step when one
  // exists, else a recompose from session state (same composeSystem — llm.ts and this can't drift).
  const lastSystem = getLastSystem(session.id);
  const [composed, setComposed] = useState<string>();
  useEffect(() => {
    if (lastSystem !== undefined) return;
    let on = true;
    setComposed(undefined);
    void fullSystemFor(ctx, session).then((s) => on && setComposed(s));
    return () => {
      on = false;
    };
  }, [ctx, session, lastSystem]);

  // Child run: no composer/stop — control lives in the parent (its Stop cascades here).
  const sessions = useSessions();
  const parent = sessions.find((s) => s.id === session.parentId);
  const isChildRun = !!session.parentId;

  // The compaction boundary: everything before the LAST summary is kept-but-not-sent (dimmed).
  const lastSummaryIdx = useMemo(() => lastSummaryIndex(session.messages), [session.messages]);

  // toolChildren merges live links (in-flight childRuns) with settled ones (tool-result messages).
  const childRuns = useChildRuns();
  const { toolResults, toolImages, toolVideo, toolChildren, toolBrowserWindows } = useMemo(() => {
    const toolResults = new Map<string, string>();
    const toolImages = new Map<string, Image[]>();
    const toolVideo = new Map<string, Video[]>();
    const toolChildren = new Map<string, string[]>(Object.entries(childRuns));
    const toolBrowserWindows = new Map<string, string>();
    for (const m of session.messages) {
      if (m.role === "tool" && m.toolCallId) {
        toolResults.set(m.toolCallId, m.text);
        if (m.images?.length) toolImages.set(m.toolCallId, m.images);
        if (m.videos?.length) toolVideo.set(m.toolCallId, m.videos);
        if (m.childSessionIds?.length) toolChildren.set(m.toolCallId, m.childSessionIds);
        if (m.browserWindowId) toolBrowserWindows.set(m.toolCallId, m.browserWindowId);
      }
    }
    return { toolResults, toolImages, toolVideo, toolChildren, toolBrowserWindows };
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

  function submit(text: string, atts: Attachments) {
    void ctx.sessions.send(text, atts);
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
                  ctx.sessions.deleteSession(session.id);
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
          <SystemBanner name={agentName ?? undefined} system={lastSystem ?? composed ?? baseSystemFor(session)} />
          {session.loaded === false && (
            <p className="flex items-center justify-center gap-1.5 py-8 text-xs text-neutral-400">
              <RefreshCw size={12} className="animate-spin" /> {t("session.loading")}
            </p>
          )}
          {session.messages.map((m, i) =>
            // Tool results fold into the assistant's tool card; heal corrections are model-only.
            // A summary renders as the compaction boundary: messages above it stay visible (dimmed)
            // but are no longer sent to the model — compaction is a send policy, not a rewrite.
            m.role === "tool" || m.hidden ? null : m.summary ? (
              <CompactionMarker key={m.id} text={m.text} />
            ) : (
              <div key={m.id} className={i < lastSummaryIdx ? "opacity-60" : undefined}>
                <Message
                  role={m.role}
                  text={m.text}
                  thinking={m.thinking}
                  images={m.images}
                  videos={m.videos}
                  files={m.files}
                  createdAt={m.createdAt}
                  toolCalls={m.toolCalls}
                  results={toolResults}
                  toolImages={toolImages}
                  toolVideo={toolVideo}
                  toolChildren={toolChildren}
                  toolBrowserWindows={toolBrowserWindows}
                  streaming={streaming && i === session.messages.length - 1}
                />
              </div>
            ),
          )}
        </div>
      </div>

      <div className="px-6 pb-6">
        {isChildRun ? (
          // A sub-agent run is user-drivable: while it runs the input is LOCKED (stop it to guide it); once
          // stopped/finished, send a message to continue it. Its result still flows up to the parent on
          // finish. Deleting removes only this run log — a delivered answer survives in the parent.
          <div className="mx-auto max-w-3xl">
            <Composer
              disabled={compacting || full}
              modelLabel={session.meta.lastModel}
              streaming={streaming}
              onStop={() => ctx.sessions.stopChild(session.id)}
              onSubmit={submit}
            />
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <span className="px-1 text-xs text-neutral-500">{t("agents.childRun")}</span>
              {parent && (
                <button
                  type="button"
                  onClick={() => setActive(parent.id)}
                  className="rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  {t("agents.toParent", { title: parent.title })}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  // Capture parent id before the delete switches the active session.
                  const pid = parent?.id;
                  ctx.sessions.deleteSession(session.id);
                  if (pid) setActive(pid);
                }}
                className="flex items-center gap-1.5 rounded-2xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 size={12} /> {t("agents.deleteRun")}
              </button>
            </div>
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
            {runner ? (
              <p className="mx-auto mb-1 max-w-3xl text-center text-xs text-neutral-500">
                {runner.state === "healing" ? t("session.healing", { round: runner.round ?? 1 }) : t("session.waitingInput")}
              </p>
            ) : null}
            <Composer
              disabled={compacting || full}
              modelLabel={session.meta.lastModel}
              streaming={streaming}
              onStop={() => ctx.sessions.stopTurn(session.id)}
              onSubmit={submit}
            />
          </>
        )}
      </div>
    </div>
  );
}

// The compaction boundary: a divider naming what happened + the summary the model got, collapsed.
// Older messages stay above it (dimmed) — compaction never removes anything from the transcript.
function CompactionMarker({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        <span>{t("session.compactedDivider")}</span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>
      <details className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        <summary className="cursor-pointer select-none">{t("session.compactedSummary")}</summary>
        <div className="mt-2 whitespace-pre-wrap text-neutral-600">{text}</div>
      </details>
    </div>
  );
}
