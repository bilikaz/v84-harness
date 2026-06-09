import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

import { Row, fieldInput } from "./Field.tsx";
import { detectModels, saveProvider, useProvider } from "../../lib/settings.ts";
import { fmtTokens } from "../../lib/format.ts";
import type { ProviderKind, ReasoningEffort } from "../../providers/types.ts";

export function ProviderSection() {
  const { t } = useTranslation();
  const cfg = useProvider();
  const [detecting, setDetecting] = useState(false);
  const [msg, setMsg] = useState("");

  async function detect() {
    if (detecting) return;
    setDetecting(true);
    setMsg("");
    const r = await detectModels();
    setDetecting(false);
    setMsg(r.ok ? t("provider.found", { count: r.count }) : t("provider.failed", { error: r.error }));
  }

  const hasModels = (cfg.models?.length ?? 0) > 0;
  // System reserve can't go below 10% of the context window.
  const minReserve = cfg.contextLength ? Math.floor(cfg.contextLength * 0.1) : 0;
  const reserveBelowMin = minReserve > 0 && !!cfg.contextReserve && cfg.contextReserve < minReserve;

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("provider.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("provider.subtitle")}</p>

      <Row label={t("provider.provider")}>
        <select
          value={cfg.provider}
          onChange={(e) => saveProvider({ provider: e.target.value as ProviderKind })}
          className={fieldInput}
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
        </select>
      </Row>

      <Row label={t("provider.baseUrl")}>
        <input
          value={cfg.baseUrl}
          onChange={(e) => saveProvider({ baseUrl: e.target.value })}
          placeholder="/llm or https://…"
          className={fieldInput}
        />
      </Row>

      <Row label={t("provider.model")}>
        <div className="flex w-80 items-center gap-2">
          {hasModels ? (
            <select
              value={cfg.model}
              onChange={(e) =>
                saveProvider({ model: e.target.value, contextLength: cfg.modelLimits?.[e.target.value] })
              }
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            >
              {cfg.model && !cfg.models!.includes(cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
              {cfg.models!.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={cfg.model}
              onChange={(e) => saveProvider({ model: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
          )}
          <button
            type="button"
            onClick={detect}
            disabled={detecting}
            title="Detect available models"
            className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            <RefreshCw size={14} className={detecting ? "animate-spin" : ""} />
            {t("provider.detect")}
          </button>
        </div>
      </Row>
      {msg && <p className="py-2 text-xs text-neutral-500">{msg}</p>}
      {cfg.contextLength != null && (
        <p className="pb-2 text-xs text-neutral-500">
          {t("provider.contextWindow", { tokens: fmtTokens(cfg.contextLength) })}
        </p>
      )}

      <Row label={t("provider.inputModalities")}>
        <div className="flex w-72 items-center gap-4">
          {(["image", "video", "audio"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={!!cfg.input?.[m]}
                onChange={(e) => saveProvider({ input: { ...cfg.input, [m]: e.target.checked } })}
              />
              {t(`provider.${m}`)}
            </label>
          ))}
        </div>
      </Row>

      <Row label={t("provider.reasoning")}>
        <select
          value={cfg.reasoningEffort ?? "off"}
          onChange={(e) => saveProvider({ reasoningEffort: e.target.value as ReasoningEffort })}
          className={fieldInput}
        >
          <option value="off">{t("provider.off")}</option>
          <option value="low">{t("provider.low")}</option>
          <option value="medium">{t("provider.medium")}</option>
          <option value="high">{t("provider.high")}</option>
        </select>
      </Row>

      {cfg.reasoningEffort && cfg.reasoningEffort !== "off" && (
        <Row label={t("provider.thinkingBudget")}>
          <input
            type="number"
            value={cfg.thinkingBudget ?? ""}
            onChange={(e) => saveProvider({ thinkingBudget: e.target.value ? Number(e.target.value) : undefined })}
            placeholder={t("provider.noBudget")}
            className={fieldInput}
          />
        </Row>
      )}

      <Row label={t("provider.maxOutput")}>
        <input
          type="number"
          value={cfg.maxTokens ?? ""}
          onChange={(e) => saveProvider({ maxTokens: e.target.value ? Number(e.target.value) : undefined })}
          placeholder={t("provider.providerDefault")}
          className={fieldInput}
        />
      </Row>

      <Row label={t("provider.contextReserve")}>
        <div className="flex w-72 flex-col gap-1">
          <input
            type="number"
            name="system-reserve"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            value={cfg.contextReserve ?? ""}
            min={minReserve || undefined}
            onChange={(e) => saveProvider({ contextReserve: e.target.value ? Number(e.target.value) : undefined })}
            onBlur={(e) => {
              const v = e.target.value ? Number(e.target.value) : undefined;
              if (v !== undefined && minReserve && v < minReserve) saveProvider({ contextReserve: minReserve });
            }}
            placeholder="50000"
            className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none ${
              reserveBelowMin ? "border-red-400 focus:border-red-500" : "border-neutral-200 focus:border-neutral-400"
            }`}
          />
          {minReserve > 0 && (
            <span className={`text-xs ${reserveBelowMin ? "text-red-600" : "text-neutral-400"}`}>
              {reserveBelowMin
                ? `Minimum is 10% of the window — ${fmtTokens(minReserve)} (will be raised)`
                : `min 10% = ${fmtTokens(minReserve)}`}
            </span>
          )}
        </div>
      </Row>

      <Row label={t("provider.apiKey")}>
        <input
          type="password"
          name="llm-api-key"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          value={cfg.apiKey}
          onChange={(e) => saveProvider({ apiKey: e.target.value })}
          placeholder={t("provider.apiKeyPlaceholder")}
          className={fieldInput}
        />
      </Row>
    </div>
  );
}
