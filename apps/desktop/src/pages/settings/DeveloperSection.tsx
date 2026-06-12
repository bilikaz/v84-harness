import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Row } from "./Field.tsx";
import { llmDebugEnabled, setLlmDebug } from "../../llm/debug.ts";
import { cn } from "../../lib/cn.ts";

export function DeveloperSection() {
  const { t } = useTranslation();
  const [debug, setDebug] = useState(llmDebugEnabled());

  function toggle() {
    const next = !debug;
    setDebug(next);
    setLlmDebug(next);
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("developer.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("developer.subtitle")}</p>

      <Row label={t("developer.llmDebug")}>
        <button
          type="button"
          role="switch"
          aria-checked={debug}
          onClick={toggle}
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors",
            debug ? "bg-neutral-900" : "bg-neutral-300",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
              debug ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
      </Row>
      <p className="pb-2 text-xs text-neutral-400">{t("developer.llmDebugHint")}</p>
    </div>
  );
}
