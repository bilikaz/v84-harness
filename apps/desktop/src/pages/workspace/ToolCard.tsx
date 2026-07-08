import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, ChevronDown, Globe, RefreshCw, SquareArrowOutUpRight, Terminal, Wrench } from "lucide-react";

import { setActive, useSessions } from "../../core/sessions/index.ts";
import { browserFleet, useFleetWindows } from "../../core/browser.ts";
import { SavableMedia } from "../../components/SavableMedia.tsx";
import { navigate } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";
import type { Image, Video, ToolCallRequest } from "../../lib/types.ts";

// Tool call card (IN/OUT, collapsed by default); memoized — props must come from reference-stable message objects.
export const ToolCard = memo(function ToolCard({
  call,
  output,
  images,
  videos,
  childSessionIds,
  browserWindowId,
}: {
  call: ToolCallRequest;
  output?: string;
  images?: Image[];
  videos?: Video[];
  childSessionIds?: string[];
  browserWindowId?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    /* keep {} */
  }
  const isAgent = call.name === "RunAgent" || call.name === "ListAgents";
  const isBrowser = call.name === "Browser" || call.name === "BrowserContent" || call.name === "BrowserDescribe" || call.name === "ActiveBrowsers";
  const summary = String(args.agent ?? args.command ?? args.path ?? args.pattern ?? args.url ?? "");
  const inText = call.name === "RunScript" ? String(args.path ?? "") : JSON.stringify(args, null, 2);
  const Icon = call.name === "RunScript" ? Terminal : isAgent ? Bot : isBrowser ? Globe : Wrench;

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
      {childSessionIds && childSessionIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-neutral-200 px-3 py-1.5">
          {childSessionIds.map((csid) => (
            <ChildRunLink key={csid} sid={csid} />
          ))}
        </div>
      )}
      {browserWindowId && (
        <div className="flex flex-wrap gap-1.5 border-t border-neutral-200 px-3 py-1.5">
          <BrowserWindowLink id={browserWindowId} />
        </div>
      )}
      {images && images.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 p-2">
          {images.map((im, i) => (
            <SavableMedia kind="image" key={i} src={im.url} name={im.name} badge={im.ref} className="max-h-64 cursor-zoom-in rounded-lg object-cover" />
          ))}
        </div>
      )}
      {videos && videos.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 p-2">
          {videos.map((v, i) => (
            <SavableMedia kind="video" key={i} src={v.url} name={v.name} badge={v.ref} className="max-h-72 rounded-lg" />
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

// A deleted child renders a tombstone, not a gap — the run's answer survives in the parent's tool result.
function ChildRunLink({ sid }: { sid: string }) {
  const { t } = useTranslation();
  const child = useSessions().find((s) => s.id === sid);
  if (!child)
    return (
      <span
        title={t("agents.deletedRunHint")}
        className="flex shrink-0 cursor-default items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-neutral-300 line-through"
      >
        <SquareArrowOutUpRight size={11} /> {t("agents.deletedRun")}
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => {
        setActive(sid);
        navigate("");
      }}
      title={t("agents.viewRun")}
      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
    >
      <SquareArrowOutUpRight size={11} /> {child.title}
    </button>
  );
}

// A live window is a clickable link (opens the overlay); a closed one is a tombstone — same shape as
// ChildRunLink, reading liveness from the fleet instead of the sessions store. Live status (the load dot)
// lives only in the right-rail panel, not here.
function BrowserWindowLink({ id }: { id: string }) {
  const { t } = useTranslation();
  const win = useFleetWindows().find((w) => w.id === id);
  if (!win)
    return (
      <span className="flex shrink-0 cursor-default items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-neutral-300 line-through">
        <Globe size={11} /> {t("browser.deletedWindow")}
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => browserFleet().view(id)}
      title={t("browser.title")}
      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
    >
      <Globe size={11} /> {win.title || win.url}
    </button>
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
