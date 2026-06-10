import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, RefreshCw, Terminal, Wrench } from "lucide-react";

import { SavableMedia } from "../../components/SavableMedia.tsx";
import { cn } from "../../lib/cn.ts";
import type { MediaRef, ToolCall } from "../../lib/types.ts";

// A tool call rendered as a card: the tool name on top, then IN (the call's
// arguments) and OUT (the result, once it arrives). Collapsed by default.
// Memoized — all props come from settled, reference-stable message objects, so
// cards re-render only when their own result/media lands.
export const ToolCard = memo(function ToolCard({ call, output, images, video }: { call: ToolCall; output?: string; images?: MediaRef[]; video?: MediaRef[] }) {
  const { t } = useTranslation();
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
            <SavableMedia kind="image" key={i} src={im.url} name={im.name} className="max-h-64 cursor-zoom-in rounded-lg object-cover" />
          ))}
        </div>
      )}
      {video && video.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 p-2">
          {video.map((v, i) => (
            <SavableMedia kind="video" key={i} src={v.url} name={v.name} className="max-h-72 rounded-lg" />
          ))}
        </div>
      )}
      {open && (
        <div className="border-t border-neutral-200">
          <IO label="IN" body={inText} />
          {output !== undefined ? <IO label="OUT" body={output} /> : <div className="px-3 py-2 text-xs text-neutral-400">{t("session.running")}</div>}
        </div>
      )}
    </div>
  );
});

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
