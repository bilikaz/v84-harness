import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Sparkles } from "lucide-react";

import { cn } from "../../lib/cn.ts";

// Collapsible reasoning block; auto-expands while streaming, user-toggleable after; memoized.
export const Thinking = memo(function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation();
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
        {streaming ? t("session.thinking") : t("session.thoughts")}
        <ChevronDown size={13} className={cn("ml-auto transition-transform", open && "rotate-180")} />
      </div>
      {open && (
        <div className="whitespace-pre-wrap px-3 pb-3 text-xs italic leading-relaxed text-violet-500/90">
          {text}
        </div>
      )}
    </div>
  );
});
