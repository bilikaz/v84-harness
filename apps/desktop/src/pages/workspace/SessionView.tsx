import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, PanelRight, Pencil, Plus, RefreshCw, Square, Trash2 } from "lucide-react";

import {
  contextLimit,
  deleteSession,
  isFull,
  renameSession,
  send,
  stopTurn,
  useActiveSession,
  useCompacting,
  useStreaming,
} from "../../core/sessions/index.ts";
import { detectModels, useProvider } from "../../core/settings.ts";
import { useOutsideClick } from "../../lib/hooks.ts";
import { fmtTokens } from "../../lib/format.ts";
import { navigate } from "../../lib/router.ts";
import { toggleRightPanel, useRightPanel } from "../../lib/ui.ts";
import { AttachmentList } from "../../components/AttachmentList.tsx";
import { InlineEdit } from "../../components/InlineEdit.tsx";
import { Message } from "./Message.tsx";
import { readAttachments } from "../../lib/attachments.ts";
import { cn } from "../../lib/cn.ts";
import type { FileAttachment, ImageRef } from "../../lib/types.ts";

// The main center: active session transcript + the composer (model selector,
// detect button, send). Reads the session + provider stores.
export function SessionView() {
  const { t } = useTranslation();
  const session = useActiveSession();
  const streaming = useStreaming();
  const compacting = useCompacting();
  const provider = useProvider();
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ImageRef[]>([]);
  const [videos, setVideos] = useState<ImageRef[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [attachNote, setAttachNote] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rightPanel = useRightPanel();
  const full = isFull(provider, session);
  const canSend =
    (input.trim().length > 0 || images.length > 0 || videos.length > 0 || files.length > 0) &&
    !streaming &&
    !compacting &&
    !full;

  // Usable context budget (window − reserve) for the composer's "full" notice.
  const ctxLimit = contextLimit(provider);
  const used = session.usedTokens ?? 0;

  // Map each tool call's id → its result text, so the assistant's tool card can
  // show the OUT next to the IN. Memoized on the messages array so renders
  // caused by local state (composer input, menus) don't rebuild them.
  const { toolResults, toolImages, toolVideo } = useMemo(() => {
    const toolResults = new Map<string, string>();
    const toolImages = new Map<string, ImageRef[]>();
    const toolVideo = new Map<string, ImageRef[]>();
    for (const m of session.messages) {
      if (m.role === "tool" && m.toolCallId) {
        toolResults.set(m.toolCallId, m.text);
        if (m.images?.length) toolImages.set(m.toolCallId, m.images);
        if (m.video?.length) toolVideo.set(m.toolCallId, m.video);
      }
    }
    return { toolResults, toolImages, toolVideo };
  }, [session.messages]);

  // Close the title menu on outside click.
  useOutsideClick(menuOpen, headerRef, () => setMenuOpen(false));

  // Auto-grow the composer with its content, up to the textarea's max-height
  // (then it scrolls). Runs on every input change, incl. the reset after submit.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // ── Transcript scrolling ─────────────────────────────────────────────────
  // Stick to the bottom as messages stream IN — but only while the user is
  // already at the bottom. If they've scrolled up to read, leave them be. On
  // switching chats, restore the position they were last at (bottom on first
  // open), so you're not dumped at the top.
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

  // Follow new/streaming content only when pinned to the bottom.
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

  async function detect() {
    if (detecting) return;
    setDetecting(true);
    try {
      await detectModels();
    } finally {
      setDetecting(false);
    }
  }

  // Turn a FileList (picked, dropped, or pasted) into composer attachments,
  // dropping media the model can't accept. Images default on; video requires
  // the model to explicitly declare video input.
  async function addAttachments(list: FileList) {
    const { images: imgs, video: vids, files: fs } = await readAttachments(list);
    if (imgs.length) {
      if (provider.input?.image === false) setAttachNote(t("session.noImageSupport"));
      else {
        setImages((prev) => [...prev, ...imgs]);
        setAttachNote("");
      }
    }
    if (vids.length) {
      if (!provider.input?.video) setAttachNote(t("session.noVideoSupport"));
      else {
        setVideos((prev) => [...prev, ...vids]);
        setAttachNote("");
      }
    }
    if (fs.length) setFiles((prev) => [...prev, ...fs]);
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    if (el.files?.length) await addAttachments(el.files);
    el.value = ""; // allow re-picking the same file
  }

  // Paste an image/video straight from the clipboard (e.g. a screenshot) as an
  // attachment. Only intercept when the clipboard actually carries media —
  // otherwise let the normal text paste through.
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const list = e.clipboardData?.files;
    if (!list?.length) return;
    const hasMedia = Array.from(list).some((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!hasMedia) return;
    e.preventDefault();
    void addAttachments(list);
  }

  function submit() {
    if (!canSend) return;
    const t = input.trim();
    const imgs = images;
    const vids = videos;
    const fs = files;
    setInput("");
    setImages([]);
    setVideos([]);
    setFiles([]);
    void send(t, provider, {
      images: imgs.length ? imgs : undefined,
      video: vids.length ? vids : undefined,
      files: fs.length ? fs : undefined,
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
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
          {session.loaded === false && (
            <p className="flex items-center justify-center gap-1.5 py-8 text-xs text-neutral-400">
              <RefreshCw size={12} className="animate-spin" /> {t("session.loading")}
            </p>
          )}
          {session.messages.map((m, i) =>
            // Tool-result messages are folded into the assistant's tool card (by
            // toolCallId); compaction summaries + heal corrections are hidden
            // (sent to the model only).
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
                streaming={streaming && i === session.messages.length - 1}
              />
            ),
          )}
        </div>
      </div>

      <div className="px-6 pb-6">
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
        <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
          <AttachmentList
            className="mb-2 px-1"
            images={images}
            videos={videos}
            files={files}
            onRemoveImage={(i) => setImages((prev) => prev.filter((_, j) => j !== i))}
            onRemoveVideo={(i) => setVideos((prev) => prev.filter((_, j) => j !== i))}
            onRemoveFile={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
          />
          {attachNote && <p className="mb-1 px-1 text-xs text-amber-600">{attachNote}</p>}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={t("session.placeholder")}
            className="max-h-24 w-full resize-none overflow-y-auto px-2 py-1 text-sm outline-none placeholder:text-neutral-400"
          />
          <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title={t("session.attach")}
              className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
            >
              <Plus size={18} />
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => navigate("settings/provider")}
              title={t("session.changeModel")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
            >
              {provider.model || t("session.selectModel")}
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={detect}
              disabled={detecting}
              title={t("session.detectModels")}
              className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
            >
              <RefreshCw size={18} className={detecting ? "animate-spin" : ""} />
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={() => stopTurn(session.id)}
                title={t("session.stop")}
                className="rounded-md bg-neutral-900 p-1.5 text-white hover:bg-neutral-700"
              >
                <Square size={16} className="fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                className="rounded-md bg-neutral-900 p-1.5 text-white hover:bg-neutral-700 disabled:opacity-30"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-neutral-400">{t("session.disclaimer")}</p>
      </div>
    </div>
  );
}
