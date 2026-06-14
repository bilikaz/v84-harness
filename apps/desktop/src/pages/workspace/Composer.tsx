import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, Plus, RefreshCw, Square } from "lucide-react";

import { detectModels, useProvider } from "../../core/settings.ts";
import { effectiveImageMaxDim, getAppConfig } from "../../core/config/index.ts";
import { readAttachments } from "../../lib/attachments.ts";
import { navigate } from "../../lib/router.ts";
import { AttachmentList } from "../../components/AttachmentList.tsx";
import type { FileAttachment, MediaRef } from "../../lib/types.ts";
import type { Attachments } from "../../core/sessions/index.ts";

// Message composer shared by chat and agent runs — owns its input state; the parent owns what submit means.
export function Composer(props: {
  seed?: string;
  disabled?: boolean; // blocks send (context full, compacting, missing workspace)
  streaming?: boolean;
  onStop?: () => void;
  onSubmit: (text: string, atts: Attachments) => void;
}) {
  const { t } = useTranslation();
  const provider = useProvider();
  const [input, setInput] = useState(props.seed ?? "");
  const [images, setImages] = useState<MediaRef[]>([]);
  const [videos, setVideos] = useState<MediaRef[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [attachNote, setAttachNote] = useState("");
  const [detecting, setDetecting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const canSend =
    (input.trim().length > 0 || images.length > 0 || videos.length > 0 || files.length > 0) &&
    !props.streaming &&
    !props.disabled;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  async function detect() {
    if (detecting) return;
    setDetecting(true);
    try {
      await detectModels();
    } finally {
      setDetecting(false);
    }
  }

  async function addAttachments(list: FileList) {
    const maxDim = effectiveImageMaxDim(provider.imageMaxDim);
    const caps = getAppConfig().media;
    const { images: imgs, video: vids, files: fs, skipped, resized } = await readAttachments(list, {
      imageMaxDim: maxDim,
      imageMaxBytes: caps.imageMaxBytes,
      gifMaxBytes: caps.gifMaxBytes,
      videoMaxBytes: caps.videoMaxBytes,
    });
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
    // Notes last so the accept paths can't clear them; skip outranks resize when both apply.
    if (resized.length) setAttachNote(t("session.attachResized", { names: resized.join(", "), max: maxDim }));
    if (skipped.length) setAttachNote(t("session.attachTooBig", { names: skipped.join(", ") }));
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    if (el.files?.length) await addAttachments(el.files);
    el.value = ""; // allow re-picking the same file
  }

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
    const text = input.trim();
    const atts: Attachments = {
      images: images.length ? images : undefined,
      video: videos.length ? videos : undefined,
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
            {provider.model.id || t("session.selectModel")}
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={() => void detect()}
            disabled={detecting}
            title={t("session.detectModels")}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
          >
            <RefreshCw size={18} className={detecting ? "animate-spin" : ""} />
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
