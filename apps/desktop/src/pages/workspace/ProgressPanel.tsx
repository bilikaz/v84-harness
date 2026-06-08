import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw, Shrink } from "lucide-react";

import { compact, contextLimit, useActiveSession, useCompacting } from "../../core/sessions/index.ts";
import { useProvider } from "../../lib/settings.ts";
import { fmtTokens } from "../../lib/format.ts";
import type { ModelConfig } from "../../providers/types.ts";
import { cn } from "../../lib/cn.ts";
import { Modal } from "../../components/Modal.tsx";

// A right-panel contribution: the active session's progress (DAG steps),
// working folder, and context/tools. Reads the session store (no props).
export function ProgressPanel() {
  const session = useActiveSession();
  const provider = useProvider();
  return (
    <ContextWindow
      used={session.usedTokens ?? 0}
      total={provider.contextLength}
      limit={contextLimit(provider)}
      sid={session.id}
      cfg={provider}
    />
  );
}

// `total` is the model's full context window; `limit` is the usable budget
// (window − reserve). Usage is shown against the LIMIT, with the reserved
// headroom called out below.
function ContextWindow({
  used,
  total,
  limit,
  sid,
  cfg,
}: {
  used: number;
  total?: number;
  limit: number;
  sid: string;
  cfg: ModelConfig;
}) {
  const { t } = useTranslation();
  if (!total || limit <= 0) {
    return (
      <Card title={t("progress.contextWindow")}>
        <p className="text-sm text-neutral-500">{t("progress.noModel", { used: fmtTokens(used) })}</p>
      </Card>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const left = Math.max(0, limit - used);
  const reserve = total - limit;
  const full = used >= limit;
  return (
    <Card title={t("progress.contextWindow")} action={<SummarizeControl sid={sid} cfg={cfg} ratio={used / limit} />}>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-neutral-500">
          {t("progress.used", { used: fmtTokens(used), total: fmtTokens(limit) })}
        </span>
        <span className={cn("font-medium", full ? "text-red-600" : "text-neutral-700")}>
          {full ? t("progress.full") : t("progress.left", { tokens: fmtTokens(left) })}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            full ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-blue-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-400">
        {fmtTokens(reserve)} system reserved · {fmtTokens(total)} window
      </p>
    </Card>
  );
}

// Summarize = compact the conversation to free context. Gray under 70% usage,
// red above. Click opens a dialog explaining what it does before confirming.
function SummarizeControl({ sid, cfg, ratio }: { sid: string; cfg: ModelConfig; ratio: number }) {
  const compacting = useCompacting();
  const [confirm, setConfirm] = useState(false);
  const hot = ratio >= 0.7;
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        disabled={compacting}
        title="Summarize conversation to free context"
        className={cn(
          "-my-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50",
          hot ? "text-red-600" : "text-neutral-400",
        )}
      >
        {compacting ? <RefreshCw size={14} className="animate-spin" /> : <Shrink size={14} />}
        {compacting ? "Summarizing…" : "Summarize"}
      </button>
      {confirm && (
        <Modal open onClose={() => setConfirm(false)} className="w-[min(480px,92vw)]">
          <div className="px-6 py-5">
            <h2 className="text-base font-semibold text-neutral-900">Summarize conversation</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              This compresses the entire conversation into a short summary and <b>drops the full history</b>{" "}
              (including attached images and files) to free up the context window. The model keeps the summary
              and continues from it. This can’t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirm(false);
                  void compact(sid, cfg);
                }}
                className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
              >
                Summarize
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Card(props: { title: string; chevron?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">{props.title}</h3>
        {props.action ?? (props.chevron && <ChevronRight size={16} className="text-neutral-400" />)}
      </div>
      {props.children}
    </section>
  );
}

