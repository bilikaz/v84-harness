import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

import { Row, fieldInput } from "./Field.tsx";
import { detectMediaModels, saveMediaConfig, useMediaConfig } from "../../lib/media.ts";

// Image-generation provider settings (the container the GenerateImage tool
// posts to). Separate endpoint from the chat provider. The tool stays inert
// until a base URL is set here.
export function MediaSection() {
  const { t } = useTranslation();
  const cfg = useMediaConfig();
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const hasModels = (cfg.models?.length ?? 0) > 0;

  async function test() {
    if (testing) return;
    setTesting(true);
    setMsg("");
    const r = await detectMediaModels();
    setTesting(false);
    setMsg(r.ok ? t("media.found", { count: r.count }) : t("media.failed", { error: r.error }));
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("media.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("media.subtitle")}</p>

      <Row label={t("media.baseUrl")}>
        <input
          value={cfg.baseUrl}
          onChange={(e) => saveMediaConfig({ baseUrl: e.target.value })}
          placeholder="http://localhost:8000/v1"
          className={fieldInput}
        />
      </Row>

      <Row label={t("media.model")}>
        <div className="flex w-80 items-center gap-2">
          {hasModels ? (
            <select
              value={cfg.model ?? ""}
              onChange={(e) => saveMediaConfig({ model: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            >
              <option value="">{t("media.modelDefault")}</option>
              {cfg.model && !cfg.models!.includes(cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
              {cfg.models!.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={cfg.model ?? ""}
              onChange={(e) => saveMediaConfig({ model: e.target.value })}
              placeholder={t("media.modelPlaceholder")}
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
            />
          )}
          <button
            type="button"
            onClick={test}
            disabled={testing || !cfg.baseUrl}
            title={t("media.detectHint")}
            className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            <RefreshCw size={14} className={testing ? "animate-spin" : ""} />
            {t("media.detect")}
          </button>
        </div>
      </Row>
      {msg && <p className="py-2 text-xs text-neutral-500">{msg}</p>}

      <Row label={t("media.maxSize")}>
        <input
          value={cfg.maxSize ?? ""}
          onChange={(e) => saveMediaConfig({ maxSize: e.target.value })}
          placeholder="1024x1024"
          className={fieldInput}
        />
      </Row>

      <Row label={t("media.apiKey")}>
        <input
          type="password"
          name="media-api-key"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          value={cfg.apiKey ?? ""}
          onChange={(e) => saveMediaConfig({ apiKey: e.target.value })}
          placeholder={t("media.apiKeyPlaceholder")}
          className={fieldInput}
        />
      </Row>
    </div>
  );
}
