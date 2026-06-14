import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { DetectButton, Row, fieldInputFlex, fieldInputFull } from "./Field.tsx";
import {
  addModel,
  addProvider,
  assignModel,
  detectProviderModels,
  providerCaps,
  removeModel,
  removeProvider,
  slotOptions,
  updateModel,
  updateProvider,
  useMediaRegistry,
  type MediaRegistry,
} from "../../core/media.ts";
import {
  MEDIA_USE_CASES,
  type MediaApiFlavor,
  type MediaModel,
  type MediaProvider,
  type MediaUseCase,
} from "../../core/tools/types.ts";
import { useDetection } from "../../lib/hooks.ts";
import { useCtx } from "../../renderer/ctx.tsx";

const FLAVORS: readonly MediaApiFlavor[] = ["openai", "generate"];
const FLAVOR_KEY: Record<MediaApiFlavor, string> = { openai: "apiOpenai", generate: "apiGenerate" };

const FIELD = "w-80";

export function ModelsSection() {
  const { t } = useTranslation();
  const reg = useMediaRegistry();
  const [tab, setTab] = useState<"useCases" | "providers">("useCases");

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("media.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("media.subtitle")}</p>

      <div className="mt-4 flex gap-1 border-b border-neutral-200">
        {(["useCases", "providers"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
              tab === id
                ? "border-neutral-800 font-medium text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {t(`media.tab.${id}`)}
          </button>
        ))}
      </div>

      {tab === "useCases" ? <UseCasesTab reg={reg} /> : <ProvidersTab reg={reg} />}
    </div>
  );
}

function UseCasesTab({ reg }: { reg: MediaRegistry }) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mt-3 text-xs text-neutral-400">{t("media.coverageHint")}</p>
      {MEDIA_USE_CASES.map((uc) => (
        <SlotRow key={uc} uc={uc} reg={reg} />
      ))}
    </div>
  );
}

function SlotRow({ uc, reg }: { uc: MediaUseCase; reg: MediaRegistry }) {
  const { t } = useTranslation();
  const options = slotOptions(uc, reg);
  const ref = reg.assignments[uc];
  const value = ref ? `${ref.providerId}|${ref.modelId}` : "";
  const covered = !!ref && options.some((o) => `${o.ref.providerId}|${o.ref.modelId}` === value);
  return (
    <Row label={t(`media.uc.${uc}`)}>
      <div className={`flex ${FIELD} items-center gap-2`}>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${covered ? "bg-green-500" : "bg-neutral-300"}`}
          title={covered ? t("media.covered") : t("media.notCovered")}
        />
        <select
          value={covered ? value : ""}
          disabled={options.length === 0}
          onChange={(e) => {
            const [providerId, modelId] = e.target.value.split("|");
            assignModel(uc, e.target.value ? { providerId, modelId } : null);
          }}
          className={`${fieldInputFlex} disabled:bg-neutral-50 disabled:text-neutral-400`}
        >
          <option value="">{options.length === 0 ? t("media.noModels") : t("media.unassigned")}</option>
          {options.map((o) => (
            <option key={`${o.ref.providerId}|${o.ref.modelId}`} value={`${o.ref.providerId}|${o.ref.modelId}`}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </Row>
  );
}

function ProvidersTab({ reg }: { reg: MediaRegistry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div className="mt-3 flex items-center justify-end">
        <button
          onClick={() => setOpen(addProvider())}
          className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          <Plus className="h-4 w-4" /> {t("media.addProvider")}
        </button>
      </div>
      {reg.providers.length === 0 && <p className="mt-2 text-sm text-neutral-400">{t("media.empty")}</p>}
      {reg.providers.map((p) => (
        <ProviderCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
      ))}
    </div>
  );
}

function ProviderCard(props: { p: MediaProvider; open: boolean; onToggle: () => void }) {
  const { p, open } = props;
  const { t } = useTranslation();
  const ctx = useCtx();
  const bare = p.api === "generate";
  const { detecting, msg, detect } = useDetection(
    () => detectProviderModels(ctx, p.id),
    (r) => (r.ok ? t("media.found", { count: r.count }) : t("media.failed", { error: r.error })),
  );

  return (
    <div className="mt-3 rounded-lg border border-neutral-200">
      <button onClick={props.onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
          {p.name || "—"}
        </span>
        <span className="text-xs text-neutral-400">
          {t(`media.${FLAVOR_KEY[p.api]}`)} · {t("media.modelCount", { count: p.models.length })}
        </span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-4 pb-4">
          <Row label={t("media.providerName")}>
            <div className={FIELD}>
              <input
                value={p.name}
                onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                placeholder={t("media.providerNamePlaceholder")}
                className={fieldInputFull}
              />
            </div>
          </Row>

          <Row label={t("media.baseUrl")}>
            <div className={FIELD}>
              <input
                value={p.baseUrl}
                onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })}
                placeholder="http://localhost:8000/v1"
                className={fieldInputFull}
              />
            </div>
          </Row>

          <Row label={t("media.apiKey")}>
            <div className={FIELD}>
              <input
                type="password"
                name={`media-api-key-${p.id}`}
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={p.apiKey ?? ""}
                onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })}
                placeholder={t("media.apiKeyPlaceholder")}
                className={fieldInputFull}
              />
            </div>
          </Row>

          <Row label={t("media.api")}>
            <div className={FIELD}>
              <select
                value={p.api}
                onChange={(e) => updateProvider(p.id, { api: e.target.value as MediaApiFlavor })}
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
          {bare && <p className="py-1 text-xs text-neutral-400">{t("media.bareHint")}</p>}

          <div className="mt-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-neutral-700">{t("media.models")}</h4>
            {!bare && (
              <DetectButton label={t("media.detect")} busy={detecting} disabled={!p.baseUrl} title={t("media.detectHint")} onClick={detect} />
            )}
          </div>
          {msg && <p className="py-1 text-xs text-neutral-500">{msg}</p>}

          {p.models.map((m) => (
            <ModelRow key={m.id} p={p} m={m} />
          ))}
          {bare && p.models.length === 0 && <GenerateSeedRow p={p} />}
          {!bare && <AddModelRow p={p} />}

          <div className="mt-4 flex justify-end border-t border-neutral-100 pt-3">
            <button
              onClick={() => removeProvider(p.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" /> {t("media.removeProvider")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GenerateSeedRow({ p }: { p: MediaProvider }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={() => addModel(p.id, "")}
      className="mt-2 flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-50"
    >
      <Plus className="h-4 w-4" /> {t("media.addDefaultModel")}
    </button>
  );
}

function AddModelRow({ p }: { p: MediaProvider }) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState("");
  const added = new Set(p.models.map((m) => m.modelId));
  const remaining = (p.detected ?? []).filter((d) => !added.has(d));
  const [pick, setPick] = useState("");

  if (remaining.length > 0) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={fieldInputFlex}>
          <option value="">{t("media.pickModel")}</option>
          {remaining.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          disabled={!pick}
          onClick={() => {
            addModel(p.id, pick);
            setPick("");
          }}
          className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("media.addModel")}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        placeholder={t("media.customModelPlaceholder")}
        className={fieldInputFlex}
      />
      <button
        disabled={!custom.trim()}
        onClick={() => {
          addModel(p.id, custom.trim());
          setCustom("");
        }}
        className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> {t("media.addModel")}
      </button>
    </div>
  );
}

function ModelRow({ p, m }: { p: MediaProvider; m: MediaModel }) {
  const { t } = useTranslation();
  const caps = providerCaps(p.api);
  const cosmosSignal = m.promptStyle === "cosmos-json" || m.modelId.toLowerCase().includes("cosmos");

  return (
    <div className="mt-2 rounded-md border border-neutral-100 bg-neutral-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-neutral-800">{m.modelId || t("media.defaultModel")}</span>
        <button
          onClick={() => removeModel(p.id, m.id)}
          title={t("media.removeModel")}
          className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {caps.map((uc) => (
          <label key={uc} className="flex items-center gap-1.5 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={m.capabilities.includes(uc)}
              onChange={(e) =>
                updateModel(p.id, m.id, {
                  capabilities: e.target.checked ? [...m.capabilities, uc] : m.capabilities.filter((c) => c !== uc),
                })
              }
            />
            {t(`media.uc.${uc}`)}
          </label>
        ))}
      </div>

      {cosmosSignal && p.api === "openai" && (
        <label className="mt-2 flex items-center gap-1.5 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={m.promptStyle === "cosmos-json"}
            onChange={(e) => updateModel(p.id, m.id, { promptStyle: e.target.checked ? "cosmos-json" : "plain" })}
          />
          {t("media.promptStyleCosmos")}
        </label>
      )}

      {m.capabilities.includes("imageGen") && (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-32 text-sm text-neutral-600">{t("media.maxImageSize")}</span>
          <input
            value={m.maxImageSize ?? ""}
            onChange={(e) => updateModel(p.id, m.id, { maxImageSize: e.target.value })}
            placeholder="1280x1280"
            className={fieldInputFlex}
          />
        </div>
      )}
      {m.capabilities.includes("videoGen") && (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-32 text-sm text-neutral-600">{t("media.maxVideoSize")}</span>
          <input
            value={m.maxVideoSize ?? ""}
            onChange={(e) => updateModel(p.id, m.id, { maxVideoSize: e.target.value })}
            placeholder="1280x720"
            className={fieldInputFlex}
          />
        </div>
      )}
    </div>
  );
}