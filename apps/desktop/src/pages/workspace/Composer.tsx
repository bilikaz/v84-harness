import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, Plus, Square } from "lucide-react";

import { useProvider } from "../../core/settings.ts";
import { effectiveImageMaxDim, getAppConfig } from "../../core/config/index.ts";
import { clipboardFiles, readAttachments } from "../../lib/attachments.ts";
import { b64ToBytes, parseDataUrl } from "../../lib/dataUrl.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import { navigate } from "../../lib/router.ts";
import { AttachmentList } from "../../components/AttachmentList.tsx";
import type { FileAttachment, Image, Video } from "../../lib/types.ts";
import type { Attachments } from "../../core/sessions/index.ts";

// Message composer shared by chat and agent runs — owns its input state; the parent owns what submit means.
export function Composer(props: {
  seed?: string;
  disabled?: boolean; // blocks send (context full, compacting, missing workspace)
  modelLabel?: string; // the model that actually answered this chat; falls back to the configured head
  streaming?: boolean;
  lock?: boolean; // hard-lock the input itself (a running sub-agent: stop it to guide it)
  lockNote?: string; // placeholder shown while locked
  onStop?: () => void;
  onSubmit: (text: string, atts: Attachments) => void;
}) {
  const { t } = useTranslation();
  const provider = useProvider();
  const ctx = useCtx();
  const [input, setInput] = useState(props.seed ?? "");
  const [images, setImages] = useState<Image[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [attachNote, setAttachNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A busy session QUEUES a text message (the pending inbox — delivered at the next cycle
  // boundary); attachments can't ride a pending record yet, so they still wait for idle.
  const hasAtts = images.length > 0 || videos.length > 0 || files.length > 0;
  const canSend = (input.trim().length > 0 || hasAtts) && !(props.streaming && hasAtts) && !props.disabled;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  async function addAttachments(list: FileList | File[]) {
    const maxDim = effectiveImageMaxDim(provider.imageMaxDim);
    const caps = getAppConfig().media;
    const { images: imgs, video: vids, files: fs, skipped, resized } = await readAttachments(list, {
      imageMaxDim: maxDim,
      imageMaxBytes: caps.imageMaxBytes,
      gifMaxBytes: caps.gifMaxBytes,
      videoMaxBytes: caps.videoMaxBytes,
    });
    if (imgs.length) {
      if (provider.input?.image === false) {
        // The chat model can't SEE images, but a configured image model can still USE one as a
        // generation reference (the ref annotation rides the message) — attach with a note.
        if (ctx.llm.resolve("imageEdit") ?? ctx.llm.resolve("imageGen")) {
          setImages((prev) => [...prev, ...imgs]);
          setAttachNote(t("session.imageRefOnly"));
        } else setAttachNote(t("session.noImageSupport"));
      } else {
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
    // Notes last so the accept paths can't clear them; skip outranks resize when both apply.
    if (resized.length) setAttachNote(t("session.attachResized", { names: resized.join(", "), max: maxDim }));
    if (skipped.length) setAttachNote(t("session.attachTooBig", { names: skipped.join(", ") }));
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    if (el.files?.length) await addAttachments(el.files);
    el.value = ""; // allow re-picking the same file
  }

  // Window-level paste: clipboard media lands in the composer from anywhere on the view — no need to
  // focus the textarea first (a screenshot → Ctrl+V is the whole flow). Other editable elements keep
  // their native paste; loose text pasted outside any input is dropped into the composer, focused.
  // Ref-to-latest so the document listener is registered once but sees current props/closures.
  const docPaste = useRef<(e: ClipboardEvent) => void>(() => {});
  docPaste.current = (e: ClipboardEvent) => {
    if (props.lock) return;
    const target = e.target as HTMLElement | null;
    const composerInput = inputRef.current;
    const inOtherEditable =
      target !== composerInput &&
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || !!target?.isContentEditable);
    if (inOtherEditable) return;
    const files = clipboardFiles(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      void addAttachments(files);
      composerInput?.focus();
      return;
    }
    const text = e.clipboardData?.getData("text");
    if (text && target !== composerInput) {
      e.preventDefault();
      setInput((prev) => prev + text);
      composerInput?.focus();
      return;
    }
    // Neither files nor text: an OS-clipboard bitmap Electron's DOM paste event didn't carry —
    // read it from main (absent on web, where clipboardData covers it).
    if (!text && ctx.api.readClipboardImage) {
      void ctx.api.readClipboardImage().then((url) => {
        const parsed = url ? parseDataUrl(url) : null;
        if (!parsed) return;
        // Time-suffixed so repeated pastes stay distinguishable (the name is display + save suggestion only).
        void addAttachments([new File([new Uint8Array(b64ToBytes(parsed.b64))], `pasted-${Date.now()}.png`, { type: parsed.mime })]);
        composerInput?.focus();
      });
    }
  };
  useEffect(() => {
    const h = (e: ClipboardEvent): void => docPaste.current(e);
    document.addEventListener("paste", h);
    return () => document.removeEventListener("paste", h);
  }, []);

  function submit() {
    if (!canSend) return;
    const text = input.trim();
    const atts: Attachments = {
      images: images.length ? images : undefined,
      videos: videos.length ? videos : undefined,
      files: files.length ? files : undefined,
    };
    setInput("");
    setImages([]);
    setVideos([]);
    setFiles([]);
    setAttachNote("");
    props.onSubmit(text, atts);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <>
      <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <AttachmentList
          className="mb-2 px-1"
          images={images}
          videos={videos}
          files={files}
          // The note describes the last attach action — any change to the attachment set clears it as stale.
          onRemoveImage={(i) => {
            setImages((prev) => prev.filter((_, j) => j !== i));
            setAttachNote("");
          }}
          onRemoveVideo={(i) => {
            setVideos((prev) => prev.filter((_, j) => j !== i));
            setAttachNote("");
          }}
          onRemoveFile={(i) => {
            setFiles((prev) => prev.filter((_, j) => j !== i));
            setAttachNote("");
          }}
        />
        {attachNote && <p className="mb-1 px-1 text-xs text-amber-600">{attachNote}</p>}
        <textarea
          ref={inputRef}
          rows={1}
          value={props.lock ? "" : input}
          disabled={props.lock}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.lock ? props.lockNote ?? t("session.placeholder") : t("session.placeholder")}
          className="max-h-24 w-full resize-none overflow-y-auto px-2 py-1 text-sm outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:bg-transparent"
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
            {props.modelLabel || provider.model.id || t("session.selectModel")}
            <ChevronDown size={14} />
          </button>
          {props.streaming ? (
            <button
              type="button"
              onClick={props.onStop}
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
    </>
  );
}
