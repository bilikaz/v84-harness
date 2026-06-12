import { useTranslation } from "react-i18next";

import { DetectButton, Row, fieldInput, fieldInputBare, fieldInputFlex } from "./Field.tsx";
import { detectModels, saveProvider, useProvider } from "../../core/settings.ts";
import { getAppConfig } from "../../core/config/index.ts";
import { fmtTokens } from "../../lib/format.ts";
import { useDetection } from "../../lib/hooks.ts";
import type { ProviderKind, ReasoningEffort } from "../../providers/types.ts";

export function ProviderSection() {
  const { t } = useTranslation();
  const cfg = useProvider();
  const { detecting, msg, detect } = useDetection(detectModels, (r) =>
    r.ok ? t("provider.found", { count: r.count }) : t("provider.failed", { error: r.error }),
  );

  const hasModels = (cfg.models?.length ?? 0) > 0;
  const appCfg = getAppConfig();
  // System reserve can't go below the configured fraction of the context window.
  const minReserve = cfg.contextLength ? Math.floor(cfg.contextLength * appCfg.session.reserveMinFraction) : 0;
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
              className={fieldInputFlex}
            >
              {cfg.model && !cfg.models!.includes(cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
              {cfg.models!.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input value={cfg.model} onChange={(e) => saveProvider({ model: e.target.value })} className={fieldInputFlex} />
          )}
          <DetectButton label={t("provider.detect")} busy={detecting} title="Detect available models" onClick={detect} />
        </div>
      </Row>
      {msg && <p className="py-2 text-xs text-neutral-500">{msg}</p>}
      {cfg.contextLength != null && (
        <p className="pb-2 text-xs text-neutral-500">
          {t("provider.contextWindow", { tokens: fmtTokens(cfg.contextLength) })}
        </p>
      )}

      <Row label={t("provider.inputModalities")}>
        <div className="flex w-80 items-center gap-4">
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

      {cfg.input?.image && (
        <Row label={t("provider.imageMaxDim")}>
          <input
            type="number"
            min={1}
            value={cfg.imageMaxDim ?? ""}
            onChange={(e) => saveProvider({ imageMaxDim: e.target.value ? Number(e.target.value) : undefined })}
            onBlur={(e) => {
              // 0/negative would mean "downscale everything to nothing" — treat
              // it as unset. The read seam (effectiveImageMaxDim) also guards,
              // so this is the UI half of the fix, not the only line of defense.
              const v = e.target.value ? Number(e.target.value) : undefined;
              if (v !== undefined && v < 1) saveProvider({ imageMaxDim: undefined });
            }}
            placeholder={String(appCfg.media.imageMaxDim)}
            className={fieldInput}
          />
        </Row>
      )}

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
          <option value="xhigh">{t("provider.xhigh")}</option>
          <option value="max">{t("provider.max")}</option>
        </select>
      </Row>

      {/* Token budget applies to OpenAI-compatible (vLLM) and Gemini; Anthropic
          uses effort + adaptive thinking and ignores it (ADR-0006). */}
      {cfg.reasoningEffort && cfg.reasoningEffort !== "off" && cfg.provider !== "anthropic" && (
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
        <div className="flex w-80 flex-col gap-1">
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
            className={`w-full ${fieldInputBare} ${
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
