import { FileText, X } from "lucide-react";

import { cn } from "../lib/cn.ts";
import type { FileAttachment, Image, Video } from "../lib/types.ts";

// Image/video/file attachment previews with remove buttons.
export function AttachmentList(props: {
  images?: Image[];
  videos?: Video[];
  files?: FileAttachment[];
  onRemoveImage?: (i: number) => void;
  onRemoveVideo?: (i: number) => void;
  onRemoveFile?: (i: number) => void;
  className?: string;
}) {
  const { images = [], videos = [], files = [] } = props;
  if (!images.length && !videos.length && !files.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", props.className)}>
      {images.map((im, i) => (
        <div key={`img-${i}`} className="relative">
          <img src={im.url} alt={im.name ?? ""} className="h-16 w-16 rounded-lg object-cover" />
          <RemoveDot onClick={() => props.onRemoveImage?.(i)} />
        </div>
      ))}
      {videos.map((v, i) => (
        <div key={`vid-${i}`} className="relative">
          <video src={v.url} className="h-16 w-24 rounded-lg object-cover" />
          <RemoveDot onClick={() => props.onRemoveVideo?.(i)} />
        </div>
      ))}
      {files.map((f, i) => (
        <span
          key={`file-${i}`}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600"
        >
          <FileText size={12} className="shrink-0 text-neutral-400" />
          <span className="max-w-[12rem] truncate">{f.name}</span>
          <button type="button" onClick={() => props.onRemoveFile?.(i)} className="text-neutral-400 hover:text-neutral-700">
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

function RemoveDot({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-800 p-0.5 text-white hover:bg-neutral-600"
    >
      <X size={12} />
    </button>
  );
}
