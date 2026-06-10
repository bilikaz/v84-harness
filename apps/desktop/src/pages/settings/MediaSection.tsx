import { useTranslation } from "react-i18next";

import { DetectButton, Row, fieldInput, fieldInputFlex } from "./Field.tsx";
import { detectMediaModels, saveMediaConfig, useMediaConfig } from "../../lib/media.ts";
import { useDetection } from "../../lib/hooks.ts";

// Image-generation provider settings (the container the GenerateImage tool
// posts to). Separate endpoint from the chat provider. The tool stays inert
// until a base URL is set here.
export function MediaSection() {
  const { t } = useTranslation();
  const cfg = useMediaConfig();
  const hasModels = (cfg.models?.length ?? 0) > 0;
  const { detecting: testing, msg, detect: test } = useDetection(detectMediaModels, (r) =>
    r.ok ? t("media.found", { count: r.count }) : t("media.failed", { error: r.error }),
  );

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
              className={fieldInputFlex}
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
              className={fieldInputFlex}
            />
          )}
          <DetectButton label={t("media.detect")} busy={testing} disabled={!cfg.baseUrl} title={t("media.detectHint")} onClick={test} />
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
