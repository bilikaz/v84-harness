import { useTranslation } from "react-i18next";

import { cn } from "../lib/cn.ts";
import type { ToolPermission } from "../core/tools/types.ts";

// i18n keys, translated at render (the module-level constant can't call t()).
const MODES: { value: ToolPermission; labelKey: string; hintKey: string }[] = [
  { value: 0, labelKey: "workspace.modeOff", hintKey: "workspace.modeOffHint" },
  { value: 1, labelKey: "workspace.modeAsk", hintKey: "workspace.modeAskHint" },
  { value: 2, labelKey: "workspace.modeAuto", hintKey: "workspace.modeAutoHint" },
];

export function ToolModePicker(props: { value: ToolPermission; onChange: (m: ToolPermission) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex overflow-hidden rounded-lg border border-neutral-200">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={t(m.hintKey)}
          onClick={() => props.onChange(m.value)}
          className={cn(
            "px-2.5 py-1 text-xs",
            props.value === m.value
              ? "bg-neutral-900 text-white"
              : "bg-white text-neutral-600 hover:bg-neutral-100",
          )}
        >
          {t(m.labelKey)}
        </button>
      ))}
    </div>
  );
}
