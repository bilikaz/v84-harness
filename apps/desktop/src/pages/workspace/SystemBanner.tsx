import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, ChevronDown } from "lucide-react";

import { Markdown } from "../../components/Markdown.tsx";
import { cn } from "../../lib/cn.ts";

// Collapsible "what is this session configured with" header for agent runs and agent-spawned chats.
export function SystemBanner({ name, system, defaultOpen = false }: { name: string; system: string; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="select-none rounded-lg border border-neutral-200 bg-neutral-50/80">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-500"
      >
        <Bot size={13} />
        {t("agents.systemBanner", { name })}
        <ChevronDown size={13} className={cn("ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        (system ? (
          <Markdown text={system} className="px-3 pb-3 text-xs leading-relaxed text-neutral-600" />
        ) : (
          <p className="px-3 pb-3 text-xs italic text-neutral-400">{t("agents.noSystem")}</p>
        ))}
    </div>
  );
}
