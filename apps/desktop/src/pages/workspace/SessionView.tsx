import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, FileText, PanelRight, Pencil, Plus, RefreshCw, Sparkles, Square, Terminal, Trash2, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
import { detectModels, useProvider } from "../../lib/settings.ts";
import { fmtTokens } from "../../lib/format.ts";
import { navigate } from "../../lib/router.ts";
import { openLightbox, toggleRightPanel, useRightPanel } from "../../lib/ui.ts";
import { readAttachments } from "../../lib/attachments.ts";
import { cn } from "../../lib/cn.ts";
import type { FileAttachment, ImageRef, Role, ToolCall } from "../../lib/types.ts";

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
  // show the OUT next to the IN.
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

  // Close the title menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: PointerEvent) {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

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

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    if (el.files?.length) {
      const { images: imgs, video: vids, files: fs } = await readAttachments(el.files);
      // Guardrails: drop media the model can't accept. Images default on; video
      // requires the model to explicitly declare video input.
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
    el.value = ""; // allow re-picking the same file
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
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={commitRename}
              className="rounded-md px-1.5 py-0.5 text-sm font-medium text-neutral-800 outline-none ring-1 ring-neutral-300"
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
          title={rightPanel ? "Hide panel" : "Show panel"}
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
            <RefreshCw size={12} className="animate-spin" /> Summarizing earlier messages to free context…
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
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {images.map((im, i) => (
                <div key={i} className="relative">
                  <img src={im.url} alt={im.name ?? ""} className="h-16 w-16 rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-800 p-0.5 text-white hover:bg-neutral-600"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {videos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {videos.map((v, i) => (
                <div key={i} className="relative">
                  <video src={v.url} className="h-16 w-24 rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={() => setVideos((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-800 p-0.5 text-white hover:bg-neutral-600"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {files.map((f, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600"
                >
                  <FileText size={12} className="shrink-0 text-neutral-400" />
                  <span className="max-w-[12rem] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="text-neutral-400 hover:text-neutral-700"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {attachNote && <p className="mb-1 px-1 text-xs text-amber-600">{attachNote}</p>}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("session.placeholder")}
            style={{ maxHeight: "6rem" }}
            className="w-full resize-none overflow-y-auto px-2 py-1 text-sm outline-none placeholder:text-neutral-400"
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
              title="Change provider / model"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
            >
              {provider.model || t("session.selectModel")}
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={detect}
              disabled={detecting}
              title="Detect available models"
              className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
            >
              <RefreshCw size={18} className={detecting ? "animate-spin" : ""} />
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={() => stopTurn(session.id)}
                title="Stop"
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

function Message({
  role,
  text,
  thinking,
  images,
  video,
  files,
  toolCalls,
  results,
  toolImages,
  toolVideo,
  streaming,
}: {
  role: Role;
  text: string;
  thinking?: string;
  images?: ImageRef[];
  video?: ImageRef[];
  files?: FileAttachment[];
  toolCalls?: ToolCall[];
  results?: Map<string, string>;
  toolImages?: Map<string, ImageRef[]>;
  toolVideo?: Map<string, ImageRef[]>;
  streaming: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[80%] flex-col items-end gap-2">
          {images && images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {images.map((im, i) => (
                <img
                  key={i}
                  src={im.url}
                  alt={im.name ?? ""}
                  onClick={() => openLightbox(im.url)}
                  className="max-h-48 cursor-zoom-in rounded-xl object-cover"
                />
              ))}
            </div>
          )}
          {video && video.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {video.map((v, i) => (
                <video key={i} src={v.url} controls className="max-h-48 rounded-xl" />
              ))}
            </div>
          )}
          {files && files.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {files.map((f, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
                >
                  <FileText size={12} className="shrink-0 text-neutral-400" />
                  <span className="max-w-[14rem] truncate">{f.name}</span>
                </span>
              ))}
            </div>
          )}
          {text && (
            <div className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-800">{text}</div>
          )}
        </div>
      </div>
    );
  }
  const hasTools = !!toolCalls?.length;
  return (
    <div className="space-y-2">
      {thinking && <Thinking text={thinking} streaming={streaming && !text} />}
      {(text || (streaming && !hasTools)) && (
        <div className="prose prose-sm prose-neutral max-w-none text-neutral-800 prose-pre:bg-neutral-900 prose-pre:text-neutral-100">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-neutral-400 align-middle" />}
        </div>
      )}
      {toolCalls?.map((c) => (
        <ToolCard key={c.id} call={c} output={results?.get(c.id)} images={toolImages?.get(c.id)} video={toolVideo?.get(c.id)} />
      ))}
    </div>
  );
}

// A tool call rendered as a card: the tool name on top, then IN (the call's
// arguments) and OUT (the result, once it arrives). Collapsed by default.
function ToolCard({ call, output, images, video }: { call: ToolCall; output?: string; images?: ImageRef[]; video?: ImageRef[] }) {
  const [open, setOpen] = useState(false);
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    /* keep {} */
  }
  const summary = String(args.command ?? args.path ?? args.pattern ?? "");
  const inText = call.name === "Bash" ? String(args.command ?? "") : JSON.stringify(args, null, 2);
  const Icon = call.name === "Bash" ? Terminal : Wrench;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/70 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon size={14} className="shrink-0 text-neutral-400" />
        <span className="font-medium text-neutral-700">{call.name}</span>
        {summary && <span className="truncate font-mono text-xs text-neutral-400">{summary}</span>}
        {output === undefined && <RefreshCw size={12} className="ml-auto animate-spin text-neutral-300" />}
        <ChevronDown size={14} className={cn("text-neutral-400 transition-transform", output === undefined ? "" : "ml-auto", open && "rotate-180")} />
      </button>
      {images && images.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 p-2">
          {images.map((im, i) => (
            <img
              key={i}
              src={im.url}
              alt={im.name ?? ""}
              onClick={() => openLightbox(im.url)}
              className="max-h-64 cursor-zoom-in rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      {video && video.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 p-2">
          {video.map((v, i) => (
            <video key={i} src={v.url} controls className="max-h-72 rounded-lg" />
          ))}
        </div>
      )}
      {open && (
        <div className="border-t border-neutral-200">
          <IO label="IN" body={inText} />
          {output !== undefined ? <IO label="OUT" body={output} /> : <div className="px-3 py-2 text-xs text-neutral-400">running…</div>}
        </div>
      )}
    </div>
  );
}

function IO({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex gap-3 px-3 py-2">
      <span className="w-8 shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">{label}</span>
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-700">
        {body}
      </pre>
    </div>
  );
}

// Reasoning in a distinct color — muted violet, collapsible. Auto-expands while
// the model is thinking, then collapses; the user can still toggle it after.
// The whole block toggles (not just the header line).
function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);
  return (
    <div
      onClick={() => setOpen((o) => !o)}
      className="cursor-pointer select-none rounded-lg border border-violet-100 bg-violet-50/60"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-violet-500">
        <Sparkles size={13} className={streaming ? "animate-pulse" : ""} />
        {streaming ? "Thinking…" : "Thoughts"}
        <ChevronDown size={13} className={cn("ml-auto transition-transform", open && "rotate-180")} />
      </div>
      {open && (
        <div className="whitespace-pre-wrap px-3 pb-3 text-xs italic leading-relaxed text-violet-500/90">
          {text}
        </div>
      )}
    </div>
  );
}
