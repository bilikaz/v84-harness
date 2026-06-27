import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { DetectButton, Row, fieldInputFlex, fieldInputFull } from "./Field.tsx";
import {
  addModel,
  addProvider,
  assignModels,
  detectProviderModels,
  providerCaps,
  removeModel,
  removeProvider,
  slotOptions,
  updateModel,
  updateProvider,
  useMediaRegistry,
  type MediaRegistry,
  type MediaModel,
  type MediaProvider,
  type ModelAssignment,
} from "../../core/settings.ts";
import { MEDIA_SERVICES, type MediaApiKind, type ModelService } from "../../llm/types.ts";

// Services that ModelsSection orders into priority pools — `main` is owned by the chat screen.
const USE_CASES: readonly ModelService[] = ["subAgent", ...MEDIA_SERVICES];
import { useDetection } from "../../lib/hooks.ts";
import { useCtx } from "../../renderer/ctx.tsx";

const FLAVORS: readonly MediaApiKind[] = ["openai", "generate"];
const FLAVOR_KEY: Record<MediaApiKind, string> = { openai: "apiOpenai", generate: "apiGenerate" };

const FIELD = "w-[28rem]";

export function ModelsSection() {
  const { t } = useTranslation();
  const reg = useMediaRegistry();
  const [tab, setTab] = useState<"useCases" | "providers">("useCases");

  return (
    <div className="max-w-3xl">
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
      <p className="mt-3 text-xs text-neutral-400">{t("media.poolHint")}</p>
      {USE_CASES.map((uc) => (
        <SlotRow key={uc} uc={uc} reg={reg} />
      ))}
    </div>
  );
}

const refKey = (r: ModelAssignment): string => `${r.providerId}|${r.modelId}`;

// An ordered priority pool: listed models (reorderable, removable) on top, an "add" picker
// for the rest. Position = priority — the runner fills the top with capacity first.
function SlotRow({ uc, reg }: { uc: ModelService; reg: MediaRegistry }) {
  const { t } = useTranslation();
  const options = slotOptions(uc, reg);
  const list = reg.assignments[uc] ?? [];
  const labelFor = (r: ModelAssignment): string => options.find((o) => refKey(o.ref) === refKey(r))?.label ?? refKey(r);
  const remaining = options.filter((o) => !list.some((r) => refKey(r) === refKey(o.ref)));
  const set = (next: ModelAssignment[]): void => assignModels(uc, next);
  const move = (i: number, d: number): void => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  return (
    <Row label={t(`media.uc.${uc}`)}>
      <div className={`${FIELD} space-y-1`}>
        {list.map((r, i) => (
          <div key={refKey(r)} className="flex items-center gap-1 rounded-md border border-neutral-100 bg-neutral-50/50 px-2 py-1">
            <span className="w-4 shrink-0 text-xs text-neutral-400">{i + 1}</span>
            <span className="flex-1 truncate text-sm text-neutral-800">{labelFor(r)}</span>
            <button disabled={i === 0} onClick={() => move(i, -1)} className="p-0.5 text-neutral-400 hover:text-neutral-700 disabled:opacity-30" title={t("media.moveUp")}>
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button disabled={i === list.length - 1} onClick={() => move(i, 1)} className="p-0.5 text-neutral-400 hover:text-neutral-700 disabled:opacity-30" title={t("media.moveDown")}>
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => set(list.filter((_, k) => k !== i))} className="p-0.5 text-neutral-400 hover:text-red-600" title={t("media.removeFromPool")}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {remaining.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              const [providerId, modelId] = e.target.value.split("|");
              set([...list, { providerId, modelId }]);
            }}
            className={fieldInputFlex}
          >
            <option value="">{t("media.addToPool")}</option>
            {remaining.map((o) => (
              <option key={refKey(o.ref)} value={refKey(o.ref)}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {list.length === 0 && remaining.length === 0 && <span className="text-xs text-neutral-400">{t("media.noModels")}</span>}
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
          {t(`media.${FLAVOR_KEY[p.api as MediaApiKind]}`)} · {t("media.modelCount", { count: p.models.length })}
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
                value={p.api as MediaApiKind}
                onChange={(e) => updateProvider(p.id, { api: e.target.value as MediaApiKind })}
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

      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
        <label className="flex items-center gap-1.5" title={t("media.concurrencyHint")}>
          {t("media.concurrency")}
          <input
            type="number"
            min={1}
            value={m.c ?? ""}
            placeholder="5"
            onChange={(e) => updateModel(p.id, m.id, { c: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)) })}
            className="w-16 rounded border border-neutral-200 px-1.5 py-0.5"
          />
        </label>
        {m.capabilities.includes("main") && m.capabilities.includes("subAgent") && (
          <label className="flex items-center gap-1.5" title={t("media.reserveHint")}>
            {t("media.reserve")}
            <input
              type="number"
              min={0}
              value={m.reserve ?? ""}
              placeholder="2"
              onChange={(e) => updateModel(p.id, m.id, { reserve: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
              className="w-16 rounded border border-neutral-200 px-1.5 py-0.5"
            />
          </label>
        )}
        <label className="flex items-center gap-1.5" title={t("media.ratingHint")}>
          {t("media.rating")}
          <input
            type="number"
            value={m.rating ?? ""}
            placeholder="0"
            onChange={(e) => updateModel(p.id, m.id, { rating: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="w-16 rounded border border-neutral-200 px-1.5 py-0.5"
          />
        </label>
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