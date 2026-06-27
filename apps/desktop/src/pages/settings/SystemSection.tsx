import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fieldInput, fieldInputFull, Row, Switch } from "./Field.tsx";
import { defaultSystemPrompt } from "../../core/prompts.ts";
import { getAppConfig, getConfigOverrides, setConfigOverrides } from "../../core/config/index.ts";
import { llmDebugEnabled, setLlmDebug } from "../../llm/debug.ts";

// The general "Settings" section: two tabs — the user's global system message ("User message"), and the
// app tunables ("Configuration": browser reading, async sub-agents, developer mode, LLM debug logging).
// All persist into config.app overrides (synced, follows the connection), except LLM debug (a local flag).
export function SystemSection() {
  const [tab, setTab] = useState<"message" | "config">("message");

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold text-neutral-900">Settings</h2>
      <p className="mt-1 text-sm text-neutral-500">Your assistant's default instructions, and how the harness behaves.</p>

      <div className="mt-4 flex gap-1 border-b border-neutral-200">
        {([
          ["message", "User message"],
          ["config", "Configuration"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
              tab === id ? "border-neutral-800 font-medium text-neutral-900" : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "message" ? <UserMessageTab /> : <ConfigurationTab />}
    </div>
  );
}

function UserMessageTab() {
  const { t } = useTranslation();
  const [value, setValue] = useState(getAppConfig().systemPrompt);

  function persist(): void {
    setConfigOverrides({ ...getConfigOverrides(), systemPrompt: value.trim() });
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-neutral-500">{t("system.subtitle")}</p>
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

function ConfigurationTab() {
  const { t } = useTranslation();
  const cfg = getAppConfig();
  const [settleMs, setSettleMs] = useState(cfg.browser.settleMs);
  const [graceMs, setGraceMs] = useState(cfg.browser.graceMs);
  const [shots, setShots] = useState(cfg.browser.shots);
  const [asyncAgents, setAsyncAgents] = useState(cfg.session.asyncAgents);
  const [delivery, setDelivery] = useState(cfg.session.asyncDelivery);
  const [ttlMin, setTtlMin] = useState(Math.round(cfg.session.runnerTtlMs / 60000));
  const [kvThreshold, setKvThreshold] = useState(cfg.session.kvProtectThreshold);
  const [devMode, setDevMode] = useState(cfg.developerMode);
  const [debug, setDebug] = useState(llmDebugEnabled());

  function persistBrowser(patch: { settleMs?: number; graceMs?: number; shots?: number }): void {
    const o = getConfigOverrides();
    setConfigOverrides({ ...o, browser: { ...o.browser, ...patch } });
  }
  function persistAsync(on: boolean): void {
    setAsyncAgents(on);
    const o = getConfigOverrides();
    setConfigOverrides({ ...o, session: { ...o.session, asyncAgents: on } });
  }
  function persistDelivery(mode: "synthetic" | "nudge"): void {
    setDelivery(mode);
    const o = getConfigOverrides();
    setConfigOverrides({ ...o, session: { ...o.session, asyncDelivery: mode } });
  }
  function persistSession(patch: { runnerTtlMs?: number; kvProtectThreshold?: number }): void {
    const o = getConfigOverrides();
    setConfigOverrides({ ...o, session: { ...o.session, ...patch } });
  }
  function persistDevMode(on: boolean): void {
    setDevMode(on);
    setConfigOverrides({ ...getConfigOverrides(), developerMode: on });
  }
  function toggleDebug(): void {
    const next = !debug;
    setDebug(next);
    setLlmDebug(next);
  }

  return (
    <div className="mt-4">
      <h3 className="text-base font-semibold text-neutral-900">Sub-agents</h3>
      <p className="mt-1 text-sm text-neutral-500">
        When on, RunAgent returns immediately and you're told each sub-agent's result as it finishes, instead of the
        turn blocking until every one is done. Off = the classic wait-for-all behaviour.
      </p>
      <Row label="Async sub-agents">
        <Switch on={asyncAgents} onToggle={() => persistAsync(!asyncAgents)} />
      </Row>
      {asyncAgents && (
        <Row label="Result delivery">
          <select className={fieldInput} value={delivery} onChange={(e) => persistDelivery(e.target.value as "synthetic" | "nudge")}>
            <option value="synthetic">Synthetic call (no extra round-trip)</option>
            <option value="nudge">Nudge (agent fetches it)</option>
          </select>
        </Row>
      )}

      <h3 className="mt-8 text-base font-semibold text-neutral-900">Concurrency</h3>
      <p className="mt-1 text-sm text-neutral-500">
        How long a session stays pinned to its provider after it goes idle (so a return re-warms the KV cache), and
        the context size above which a session waits for its busy provider instead of re-routing (and re-prefilling).
      </p>
      <Row label="Provider binding (minutes)">
        <input
          type="number"
          min={1}
          step={1}
          className={fieldInput}
          value={ttlMin}
          onChange={(e) => setTtlMin(e.target.valueAsNumber)}
          onBlur={() => Number.isInteger(ttlMin) && ttlMin > 0 && persistSession({ runnerTtlMs: ttlMin * 60000 })}
        />
      </Row>
      <Row label="KV-protect threshold (tokens)">
        <input
          type="number"
          min={0}
          step={1000}
          className={fieldInput}
          value={kvThreshold}
          onChange={(e) => setKvThreshold(e.target.valueAsNumber)}
          onBlur={() => Number.isInteger(kvThreshold) && kvThreshold > 0 && persistSession({ kvProtectThreshold: kvThreshold })}
        />
      </Row>

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
        tool isn't offered at all. Each run still asks for your approval.
      </p>
      <Row label="Developer mode">
        <Switch on={devMode} onToggle={() => persistDevMode(!devMode)} />
      </Row>

      <Row label={t("developer.llmDebug")}>
        <Switch on={debug} onToggle={toggleDebug} />
      </Row>
      <p className="pb-2 text-xs text-neutral-400">{t("developer.llmDebugHint")}</p>
    </div>
  );
}
