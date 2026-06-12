import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";

import { DetectButton, Row, fieldInput, fieldInputFlex } from "./Field.tsx";
import {
  addMediaModel,
  assignMediaModel,
  detectMediaModels,
  removeMediaModel,
  updateMediaModel,
  useMediaRegistry,
} from "../../core/media.ts";
import { MEDIA_USE_CASES, type MediaApiFlavor, type MediaModelConfig, type MediaUseCase } from "../../core/tools/types.ts";
import { useDetection } from "../../lib/hooks.ts";

// The media model registry UI (Settings → Models): the coverage list (which
// use-case slots are served by which model — and which aren't covered at all)
// above the model pool, where endpoints are added and described (URL, wire
// flavor, capabilities, prompt style). Tools go inert when their slot is
// unassigned — nothing here is required.

const FLAVORS: readonly MediaApiFlavor[] = ["openai-images", "plain-generate", "openai-chat"];
const FLAVOR_KEY: Record<MediaApiFlavor, string> = {
  "openai-images": "apiOpenaiImages",
  "plain-generate": "apiPlainGenerate",
  "openai-chat": "apiOpenaiChat",
};

// Which wire flavors plausibly serve a capability — the API select offers
// only these for the entry's selected capabilities (a recognition model
// doesn't speak /images/generations and vice versa). Audio has no tool yet,
// so it constrains nothing. Empty selection → all flavors.
const CAP_FLAVORS: Record<MediaUseCase, readonly MediaApiFlavor[]> = {
  imageGen: ["openai-images", "plain-generate"],
  videoGen: ["openai-images"],
  imageRec: ["openai-chat"],
  videoRec: ["openai-chat"],
  audioGen: FLAVORS,
  audioRec: ["openai-chat"],
};

function flavorsFor(capabilities: MediaUseCase[]): readonly MediaApiFlavor[] {
  if (!capabilities.length) return FLAVORS;
  const allowed = new Set(capabilities.flatMap((uc) => [...CAP_FLAVORS[uc]]));
  return FLAVORS.filter((f) => allowed.has(f));
}

const GEN_CAPS: readonly MediaUseCase[] = ["imageGen", "videoGen"];

function entryName(m: MediaModelConfig): string {
  return m.label || m.model || m.baseUrl || "—";
}

export function ModelsSection() {
  const { t } = useTranslation();
  const reg = useMediaRegistry();

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("media.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("media.subtitle")}</p>

      <h3 className="mt-5 text-sm font-semibold text-neutral-700">{t("media.coverage")}</h3>
      <p className="mt-0.5 text-xs text-neutral-400">{t("media.coverageHint")}</p>
      {MEDIA_USE_CASES.map((uc) => (
        <CoverageRow key={uc} uc={uc} entries={reg.entries} assigned={reg.assignments[uc] ?? ""} />
      ))}

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">{t("media.models")}</h3>
        <button
          onClick={() => addMediaModel()}
          className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          <Plus className="h-4 w-4" /> {t("media.add")}
        </button>
      </div>
      {reg.entries.length === 0 && <p className="mt-2 text-sm text-neutral-400">{t("media.empty")}</p>}
      {reg.entries.map((m) => (
        <ModelCard key={m.id} m={m} />
      ))}
    </div>
  );
}

function CoverageRow(props: { uc: MediaUseCase; entries: MediaModelConfig[]; assigned: string }) {
  const { t } = useTranslation();
  const candidates = props.entries.filter((e) => e.capabilities.includes(props.uc));
  const covered = !!props.assigned && candidates.some((c) => c.id === props.assigned);
  return (
    <Row label={t(`media.uc.${props.uc}`)}>
      <div className="flex w-80 items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${covered ? "bg-green-500" : "bg-neutral-300"}`}
          title={covered ? t("media.covered") : t("media.notCovered")}
        />
        {candidates.length > 0 ? (
          <select
            value={covered ? props.assigned : ""}
            onChange={(e) => assignMediaModel(props.uc, e.target.value)}
            className={fieldInputFlex}
          >
            <option value="">{t("media.unassigned")}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {entryName(c)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-neutral-400">{t("media.noCandidates")}</span>
        )}
      </div>
    </Row>
  );
}

function ModelCard({ m }: { m: MediaModelConfig }) {
  const { t } = useTranslation();
  const hasModels = (m.models?.length ?? 0) > 0;
  // A bare /generate server has no /models and takes no model parameter —
  // detection and the model picker would only produce noise, so they vanish.
  const bare = m.api === "plain-generate";
  const { detecting, msg, detect } = useDetection(
    () => detectMediaModels(m.id),
    (r) => (r.ok ? t("media.found", { count: r.count }) : t("media.failed", { error: r.error })),
  );

  const isGen = m.capabilities.some((c) => GEN_CAPS.includes(c));
  const allowedFlavors = flavorsFor(m.capabilities);

  // The form follows the classification flow: connection (URL + name + key)
  // → capabilities → everything below adapts to them (suggested API types,
  // detection where the flavor has /models, generation-only settings).
  return (
    <div className="mt-3 rounded-lg border border-neutral-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-neutral-900">{entryName(m)}</span>
        <button
          onClick={() => removeMediaModel(m.id)}
          title={t("media.remove")}
          className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <Row label={t("media.baseUrl")}>
        <input
          value={m.baseUrl}
          onChange={(e) => updateMediaModel(m.id, { baseUrl: e.target.value })}
          placeholder="http://localhost:8000/v1"
          className={fieldInput}
        />
      </Row>

      <Row label={t("media.name")}>
        <input
          value={m.label}
          onChange={(e) => updateMediaModel(m.id, { label: e.target.value })}
          placeholder={t("media.labelPlaceholder")}
          className={fieldInput}
        />
      </Row>

      <Row label={t("media.apiKey")}>
        <input
          type="password"
          name={`media-api-key-${m.id}`}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          value={m.apiKey ?? ""}
          onChange={(e) => updateMediaModel(m.id, { apiKey: e.target.value })}
          placeholder={t("media.apiKeyPlaceholder")}
          className={fieldInput}
        />
      </Row>

      <Row label={t("media.capabilities")}>
        <div className="grid w-80 grid-cols-2 gap-x-4 gap-y-1">
          {MEDIA_USE_CASES.map((uc) => (
            <label key={uc} className="flex items-center gap-1.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={m.capabilities.includes(uc)}
                onChange={(e) => {
                  const capabilities = e.target.checked ? [...m.capabilities, uc] : m.capabilities.filter((c) => c !== uc);
                  // Keep the flavor inside what the new classification allows;
                  // leaving openai-images also drops the Cosmos prompt style.
                  const allowed = flavorsFor(capabilities);
                  const api = allowed.includes(m.api) ? m.api : allowed[0];
                  updateMediaModel(m.id, { capabilities, api, ...(api !== "openai-images" ? { promptStyle: "plain" as const } : {}) });
                }}
              />
              {t(`media.uc.${uc}`)}
            </label>
          ))}
        </div>
      </Row>

      <Row label={t("media.api")}>
        <select
          value={m.api}
          onChange={(e) => {
            const api = e.target.value as MediaApiFlavor;
            // The Cosmos prompt style belongs to the openai-images wire — a
            // flavor switch away from it must not leave the flag set invisibly.
            updateMediaModel(m.id, { api, ...(api !== "openai-images" ? { promptStyle: "plain" as const } : {}) });
          }}
          className={fieldInput}
        >
          {allowedFlavors.map((f) => (
            <option key={f} value={f}>
              {t(`media.${FLAVOR_KEY[f]}`)}
            </option>
          ))}
        </select>
      </Row>

      {!bare && (
        <Row label={t("media.model")}>
          <div className="flex w-80 items-center gap-2">
            {hasModels ? (
              <select
                value={m.model ?? ""}
                onChange={(e) => updateMediaModel(m.id, { model: e.target.value })}
                className={fieldInputFlex}
              >
                <option value="">{t("media.modelDefault")}</option>
                {m.model && !m.models!.includes(m.model) && <option value={m.model}>{m.model}</option>}
                {m.models!.map((mm) => (
                  <option key={mm} value={mm}>
                    {mm}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={m.model ?? ""}
                onChange={(e) => updateMediaModel(m.id, { model: e.target.value })}
                placeholder={t("media.modelPlaceholder")}
                className={fieldInputFlex}
              />
            )}
            <DetectButton label={t("media.detect")} busy={detecting} disabled={!m.baseUrl} title={t("media.detectHint")} onClick={detect} />
          </div>
        </Row>
      )}
      {bare && <p className="py-1 text-xs text-neutral-400">{t("media.bareHint")}</p>}
      {!bare && msg && <p className="py-1 text-xs text-neutral-500">{msg}</p>}

      {/* Cosmos speaks the openai-images wire — a bare /generate server can't
          be the Cosmos container, so the upsampler toggle would be noise. */}
      {isGen && m.api === "openai-images" && (
        <Row label={t("media.promptStyle")}>
          <label className="flex w-80 items-center gap-1.5 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={m.promptStyle === "cosmos-json"}
              onChange={(e) => updateMediaModel(m.id, { promptStyle: e.target.checked ? "cosmos-json" : "plain" })}
            />
            {t("media.promptStyleCosmos")}
          </label>
        </Row>
      )}

      {isGen && (
        <Row label={t("media.maxSize")}>
          <input
            value={m.maxSize ?? ""}
            onChange={(e) => updateMediaModel(m.id, { maxSize: e.target.value })}
            placeholder="1280x1280"
            className={fieldInput}
          />
        </Row>
      )}
    </div>
  );
}
