import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fieldInputFull } from "./Field.tsx";
import { defaultSystemPrompt } from "../../lib/prompts.ts";
import { getAppConfig, getConfigOverrides, setConfigOverrides } from "../../core/config/index.ts";

// The user's global system message — the BASE block for plain chats. Agents (their baked system) and
// workspaces (their own message) override it; the tool-guidance blocks (files / browser / memory) still
// append on top. Saved into config.app overrides (synced, follows the connection). Just the prompt for
// now — the section can grow later.
export function SystemSection() {
  const { t } = useTranslation();
  const [value, setValue] = useState(getAppConfig().systemPrompt);

  function persist(): void {
    setConfigOverrides({ ...getConfigOverrides(), systemPrompt: value.trim() });
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("system.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("system.subtitle")}</p>
      <textarea
        className={fieldInputFull + " mt-3 min-h-[300px] resize-y font-mono text-xs leading-relaxed"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={persist}
        placeholder={t("system.placeholder")}
      />
      <p className="mt-2 text-xs text-neutral-400">{t("system.languageHint")}</p>
      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <div className="mb-1 text-xs font-medium text-neutral-500">{t("system.defaultLabel")}</div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-600">{defaultSystemPrompt()}</pre>
      </div>
    </div>
  );
}
