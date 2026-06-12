import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";

import { DetectButton, Row, fieldInputFlex, fieldInputFull } from "./Field.tsx";
import {
  addMediaModel,
  assignMediaModel,
  detectMediaModels,
  removeMediaModel,
  slotCandidates,
  updateMediaModel,
  useMediaRegistry,
} from "../../core/media.ts";
import { MEDIA_USE_CASES, type MediaApiFlavor, type MediaModelConfig, type MediaUseCase } from "../../core/tools/types.ts";
import { useDetection } from "../../lib/hooks.ts";

// The media model registry UI (Settings → Models): the coverage list (which
// use-case slots are served by which model — and which aren't covered at all)
// above the model pool. An entry has NO capability checkboxes — the API type
// says how to talk to it, and assigning it to coverage slots IS its
// classification; the card adapts to those assignments (sizes per generation
// modality, the Cosmos enhancer only on a cosmos signal). Tools go inert when
// their slot is unassigned — nothing here is required.

const FLAVORS: readonly MediaApiFlavor[] = ["openai", "generate"];
const FLAVOR_KEY: Record<MediaApiFlavor, string> = { openai: "apiOpenai", generate: "apiGenerate" };

function entryName(m: MediaModelConfig): string {
  return m.label || m.model || m.baseUrl || "—";
}

// A cosmos-named model means the Cosmos structured-JSON prompt — surface and
// pre-check the enhancer when the name says so (detection does the same from
// the model list). Only meaningful on the OpenAI wire.
function hasCosmosSignal(m: MediaModelConfig): boolean {
  if (m.api !== "openai") return false;
  if (m.promptStyle === "cosmos-json") return true;
  return `${m.label} ${m.model ?? ""}`.toLowerCase().includes("cosmos");
}

function suggestCosmos(patch: { label?: string; model?: string }, m: MediaModelConfig): typeof patch & { promptStyle?: "cosmos-json" } {
  const name = `${patch.label ?? ""} ${patch.model ?? ""}`.toLowerCase();
  return name.includes("cosmos") && m.api === "openai" ? { ...patch, promptStyle: "cosmos-json" } : patch;
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
        <ModelCard
          key={m.id}
          m={m}
          assignedSlots={MEDIA_USE_CASES.filter((uc) => reg.assignments[uc] === m.id)}
        />
      ))}
    </div>
  );
}

function CoverageRow(props: { uc: MediaUseCase; entries: MediaModelConfig[]; assigned: string }) {
  const { t } = useTranslation();
  const candidates = slotCandidates(props.uc, props.entries);
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

function ModelCard(props: { m: MediaModelConfig; assignedSlots: MediaUseCase[] }) {
  const { m, assignedSlots } = props;
  const { t } = useTranslation();
  const hasModels = (m.models?.length ?? 0) > 0;
  const bare = m.api === "generate";
  const { detecting, msg, detect } = useDetection(
    () => detectMediaModels(m.id),
    (r) => (r.ok ? t("media.found", { count: r.count }) : t("media.failed", { error: r.error })),
  );

  // All fields share one width (w-80, via the wrapper) so the card reads as a
  // single column — rows with a button keep it by flexing inside the wrapper.
  const field = `w-80`;

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
        <div className={field}>
          <input
            value={m.baseUrl}
            onChange={(e) => updateMediaModel(m.id, { baseUrl: e.target.value })}
            placeholder="http://localhost:8000/v1"
            className={fieldInputFull}
          />
        </div>
      </Row>

      {/* ONE identity field. For the OpenAI flavor the name IS the model id:
          editable at first, Detect beside it, and a successful detect turns it
          into the model picker (choosing syncs label + model). A bare
          /generate entry has no model — the field is just its display name. */}
      <Row label={t("media.name")}>
        <div className={`flex ${field} items-center gap-2`}>
          {!bare && hasModels ? (
            <select
              value={m.model ?? ""}
              onChange={(e) => updateMediaModel(m.id, suggestCosmos({ model: e.target.value, label: e.target.value }, m))}
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
              value={bare ? m.label : m.label || m.model || ""}
              onChange={(e) =>
                updateMediaModel(
                  m.id,
                  suggestCosmos(bare ? { label: e.target.value } : { label: e.target.value, model: e.target.value }, m),
                )
              }
              placeholder={t("media.labelPlaceholder")}
              className={fieldInputFlex}
            />
          )}
          {!bare && (
            <DetectButton label={t("media.detect")} busy={detecting} disabled={!m.baseUrl} title={t("media.detectHint")} onClick={detect} />
          )}
        </div>
      </Row>
      {bare && <p className="py-1 text-xs text-neutral-400">{t("media.bareHint")}</p>}
      {!bare && msg && <p className="py-1 text-xs text-neutral-500">{msg}</p>}

      {/* The extra line right below the name — only when something signals
          Cosmos (detected model id or the typed name). */}
      {hasCosmosSignal(m) && (
        <Row label={t("media.promptStyle")}>
          <label className={`flex ${field} items-center gap-1.5 text-sm text-neutral-700`}>
            <input
              type="checkbox"
              checked={m.promptStyle === "cosmos-json"}
              onChange={(e) => updateMediaModel(m.id, { promptStyle: e.target.checked ? "cosmos-json" : "plain" })}
            />
            {t("media.promptStyleCosmos")}
          </label>
        </Row>
      )}

      <Row label={t("media.apiKey")}>
        <div className={field}>
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
            className={fieldInputFull}
          />
        </div>
      </Row>

      <Row label={t("media.api")}>
        <div className={field}>
          <select
            value={m.api}
            onChange={(e) => {
              const api = e.target.value as MediaApiFlavor;
              // A bare /generate takes no model parameter and can't be Cosmos —
              // switching drops the model id and the enhancer flag (the label
              // keeps the display name). Slots that no longer fit are cleared
              // by updateMediaModel.
              updateMediaModel(m.id, {
                api,
                ...(api === "generate" ? { model: "", promptStyle: "plain" as const } : {}),
              });
            }}
            className={fieldInputFull}
          >
            {FLAVORS.map((f) => (
              <option key={f} value={f}>
                {t(`media.${FLAVOR_KEY[f]}`)}
              </option>
            ))}
          </select>
        </div>
      </Row>

      {/* Sizes follow the entry's assignments — image cap when it generates
          images, video cap when it generates video, nothing for recognition. */}
      {assignedSlots.includes("imageGen") && (
        <Row label={t("media.maxImageSize")}>
          <div className={field}>
            <input
              value={m.maxImageSize ?? ""}
              onChange={(e) => updateMediaModel(m.id, { maxImageSize: e.target.value })}
              placeholder="1280x1280"
              className={fieldInputFull}
            />
          </div>
        </Row>
      )}
      {assignedSlots.includes("videoGen") && (
        <Row label={t("media.maxVideoSize")}>
          <div className={field}>
            <input
              value={m.maxVideoSize ?? ""}
              onChange={(e) => updateMediaModel(m.id, { maxVideoSize: e.target.value })}
              placeholder="1280x720"
              className={fieldInputFull}
            />
          </div>
        </Row>
      )}
    </div>
  );
}
