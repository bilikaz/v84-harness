import { useTranslation } from "react-i18next";
import { Play, RotateCw, Square, Workflow } from "lucide-react";

import { listGraphs } from "../../core/graph/index.ts";
import { usePluginsConfig } from "../../core/plugins/config.ts";
import { getContainer, setActiveContainer, useActiveContainerId } from "../../core/containers.ts";
import { useSessions, useStreamingIds, setActive } from "../../core/sessions/index.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import { navigate } from "../../lib/router.ts";
import { cn } from "../../lib/cn.ts";

// Right-panel "Flows" block — sibling to Agents / Browser windows. Lists each enabled plugin's graph as a
// launcher (the `start` action) and the active graph runs with open / stop / continue (the standard control
// actions). Graph identity is its plugin slug; the launcher is gated on that plugin being enabled.
export function GraphsPanel() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const plugins = usePluginsConfig();
  const sessions = useSessions();
  const streaming = useStreamingIds();
  // Are we currently in a workspace? A workspace-requiring graph's launcher is hidden outside one — the
  // run would inherit this container, and its file-reading heads would be masked to no workspace.
  const activeType = getContainer(useActiveContainerId())?.type;
  const inWorkspace = activeType === "local" || activeType === "remote";

  const graphs = listGraphs().filter((g) => plugins[g.pluginSlug]?.enabled && (inWorkspace || !g.needsWorkspace()));
  const runs = sessions.filter((s) => s.graphId);
  if (!graphs.length && !runs.length) return null;

  function launch(id: string) {
    ctx.graph.start(id, { activate: true });
    navigate("");
  }
  function open(sid: string) {
    // A run can live in a different container (workspace) than the active one — switch to it, or the session
    // opens but the app's container context (sidebar group) stays put.
    const s = sessions.find((x) => x.id === sid);
    if (s?.containerId) setActiveContainer(s.containerId);
    setActive(sid);
    navigate("");
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900">{t("graphs.title")}</h3>

      {graphs.map((g) => (
        <button
          key={g.getId()}
          type="button"
          onClick={() => launch(g.getId())}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-100/70 hover:text-neutral-900"
        >
          <Workflow size={15} className="shrink-0" />
          <span className="truncate">{g.getTitle()}</span>
        </button>
      ))}

      {runs.length > 0 && (
        <div className="mt-2 border-t border-neutral-100 pt-2">
          <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">{t("graphs.runs")}</div>
          {runs.map((s) => {
            const live = streaming.has(s.id);
            // A paused/parked run (alive but not streaming) can be continued; a finished run cannot — it shows
            // no control. Continue sends a `continue` MESSAGE (same path as typing it), never a magic resume.
            const paused = !live && ctx.graph.hasRun(s.id);
            return (
              <div key={s.id} className="group flex items-center gap-0.5 rounded-lg pr-1 hover:bg-neutral-100/70">
                <button type="button" onClick={() => open(s.id)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-sm text-neutral-600">
                  <Workflow size={15} className={cn("shrink-0", live && "text-emerald-600")} />
                  <span className="truncate">{s.title}</span>
                </button>
                {live ? (
                  <button type="button" onClick={() => ctx.graph.stop(s.id)} title={t("graphs.stop")} className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-900">
                    <Square size={13} />
                  </button>
                ) : paused ? (
                  <button type="button" onClick={() => void ctx.sessions.sendTo(s.id, "continue", { autoName: false })} title={t("graphs.continue")} className="shrink-0 rounded-md p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-900 group-hover:opacity-100">
                    <RotateCw size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {!graphs.length && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-neutral-400">
          <Play size={13} /> {t("graphs.empty")}
        </div>
      )}
    </section>
  );
}
