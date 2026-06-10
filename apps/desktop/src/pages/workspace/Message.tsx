import { FileText } from "lucide-react";

import { Markdown } from "../../components/Markdown.tsx";
import { SavableMedia } from "../../components/SavableMedia.tsx";
import { Thinking } from "./Thinking.tsx";
import { ToolCard } from "./ToolCard.tsx";
import type { FileAttachment, ImageRef, Role, ToolCall } from "../../lib/types.ts";

// One transcript entry. User messages render right-aligned with their
// attachments; assistant messages render thinking, markdown text, and a tool
// card per call (the matching results/media are passed in by id).
export function Message({
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
                <SavableMedia kind="image" key={i} src={im.url} name={im.name} className="max-h-48 cursor-zoom-in rounded-xl object-cover" />
              ))}
            </div>
          )}
          {video && video.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {video.map((v, i) => (
                <SavableMedia kind="video" key={i} src={v.url} name={v.name} className="max-h-48 rounded-xl" />
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
        <Markdown text={text} className="text-neutral-800 prose-pre:bg-neutral-900 prose-pre:text-neutral-100">
          {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-neutral-400 align-middle" />}
        </Markdown>
      )}
      {toolCalls?.map((c) => (
        <ToolCard key={c.id} call={c} output={results?.get(c.id)} images={toolImages?.get(c.id)} video={toolVideo?.get(c.id)} />
      ))}
    </div>
  );
}
