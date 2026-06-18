import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fieldInput, fieldInputFull, Row } from "./Field.tsx";
import { defaultSystemPrompt } from "../../lib/prompts.ts";
import { getAppConfig, getConfigOverrides, setConfigOverrides } from "../../core/config/index.ts";

// The user's global system message — the BASE block for plain chats. Agents (their baked system) and
// workspaces (their own message) override it; the tool-guidance blocks (files / browser / memory) still
// append on top. Saved into config.app overrides (synced, follows the connection). Just the prompt for
// now — the section can grow later.
export function SystemSection() {
  const { t } = useTranslation();
  const cfg = getAppConfig();
  const [value, setValue] = useState(cfg.systemPrompt);
  const [settleMs, setSettleMs] = useState(cfg.browser.settleMs);
  const [graceMs, setGraceMs] = useState(cfg.browser.graceMs);
  const [shots, setShots] = useState(cfg.browser.shots);
  const [devMode, setDevMode] = useState(cfg.developerMode);

  function persist(): void {
    setConfigOverrides({ ...getConfigOverrides(), systemPrompt: value.trim() });
  }

  function persistDevMode(on: boolean): void {
    setDevMode(on);
    setConfigOverrides({ ...getConfigOverrides(), developerMode: on });
  }

  function persistBrowser(patch: { settleMs?: number; graceMs?: number; shots?: number }): void {
    const o = getConfigOverrides();
    setConfigOverrides({ ...o, browser: { ...o.browser, ...patch } });
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

      <h3 className="mt-8 text-base font-semibold text-neutral-900">Browser windows</h3>
      <p className="mt-1 text-sm text-neutral-500">How the agent reads pages it opens with the Browser tool.</p>
      <Row label="Settle wait cap (ms)">
        <input
          type="number"
          min={0}
          step={500}
          className={fieldInput}
          value={settleMs}
          onChange={(e) => setSettleMs(e.target.valueAsNumber)}
          onBlur={() => Number.isFinite(settleMs) && settleMs > 0 && persistBrowser({ settleMs })}
        />
      </Row>
      <Row label="Post-load grace (ms)">
        <input
          type="number"
          min={0}
          step={500}
          className={fieldInput}
          value={graceMs}
          onChange={(e) => setGraceMs(e.target.valueAsNumber)}
          onBlur={() => Number.isFinite(graceMs) && graceMs > 0 && persistBrowser({ graceMs })}
        />
      </Row>
      <Row label="Screenshots per read">
        <input
          type="number"
          min={1}
          max={6}
          step={1}
          className={fieldInput}
          value={shots}
          onChange={(e) => setShots(e.target.valueAsNumber)}
          onBlur={() => Number.isInteger(shots) && shots > 0 && persistBrowser({ shots })}
        />
      </Row>

      <h3 className="mt-8 text-base font-semibold text-neutral-900">Developer</h3>
      <p className="mt-1 text-sm text-neutral-500">
        Lets the agent run JavaScript it writes, in a separate Node process. Off by default — when off the RunScript
        tool isn’t offered at all. Each run still asks for your approval.
      </p>
      <Row label="Developer mode">
        <input type="checkbox" className="h-4 w-4" checked={devMode} onChange={(e) => persistDevMode(e.target.checked)} />
      </Row>
    </div>
  );
}
