import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";

import { Modal } from "./Modal.tsx";
import { resolveSelect, usePendingSelects, type PendingSelect } from "../core/graph/select.ts";
import type { SelectOption } from "../core/graph/index.ts";

// Renders the next pending graph selection (the `source: "user"` path). `view: "tree"` is a cascading
// folder picker (checking a parent checks all descendants); otherwise a flat list (single- or multi-select).
// Closing resolves with an empty pick.
export function SelectModal() {
  const pending = usePendingSelects();
  const p = pending[0];
  if (!p) return null;
  return <SelectForm key={p.id} pending={p} />;
}

function SelectForm({ pending }: { pending: PendingSelect }) {
  return pending.spec.view === "tree" ? <TreeForm pending={pending} /> : <ListForm pending={pending} />;
}

function ListForm({ pending }: { pending: PendingSelect }) {
  const { t } = useTranslation();
  const { spec, id } = pending;
  const multi = !!spec.multi;
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (oid: string) => setPicked((prev) => (prev.includes(oid) ? prev.filter((x) => x !== oid) : [...prev, oid]));

  return (
    <Shell prompt={spec.prompt} onClose={() => resolveSelect(id, [])}>
      <div className="mt-4 flex flex-col gap-1.5">
        {spec.options.map((o) =>
          multi ? (
            <label key={o.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
              <input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
              <span className="truncate">{o.label}</span>
            </label>
          ) : (
            <button key={o.id} type="button" onClick={() => resolveSelect(id, [o.id])} className="flex w-full items-center rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100">
              {o.label}
            </button>
          ),
        )}
      </div>
      {multi && <Actions t={t} onCancel={() => resolveSelect(id, [])} onConfirm={() => resolveSelect(id, picked)} />}
    </Shell>
  );
}

function TreeForm({ pending }: { pending: PendingSelect }) {
  const { t } = useTranslation();
  const { spec, id } = pending;
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (node: SelectOption) =>
    setChecked((prev) => {
      const next = new Set(prev);
      const on = !prev.has(node.id);
      for (const x of collectIds(node)) (on ? next.add(x) : next.delete(x)); // cascade to all descendants
      return next;
    });

  return (
    <Shell prompt={spec.prompt} onClose={() => resolveSelect(id, [])}>
      <div className="mt-4 max-h-[50vh] overflow-auto">
        {spec.options.map((o) => (
          <TreeRow key={o.id} node={o} depth={0} checked={checked} onToggle={toggle} />
        ))}
      </div>
      <Actions t={t} onCancel={() => resolveSelect(id, [])} onConfirm={() => resolveSelect(id, [...checked])} />
    </Shell>
  );
}

function TreeRow({ node, depth, checked, onToggle }: { node: SelectOption; depth: number; checked: ReadonlySet<string>; onToggle: (n: SelectOption) => void }) {
  const isChecked = checked.has(node.id);
  const indeterminate = !isChecked && collectIds(node).some((x) => checked.has(x));
  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-100" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        <input
          type="checkbox"
          checked={isChecked}
          ref={(el) => {
            if (el) el.indeterminate = indeterminate;
          }}
          onChange={() => onToggle(node)}
        />
        <span className="truncate">{node.label}</span>
      </label>
      {node.children?.map((c) => (
        <TreeRow key={c.id} node={c} depth={depth + 1} checked={checked} onToggle={onToggle} />
      ))}
    </>
  );
}

function Shell({ prompt, onClose, children }: { prompt: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal open onClose={onClose} className="w-[min(560px,92vw)]">
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 text-neutral-900">
          <ListChecks size={18} />
          <h2 className="text-base font-semibold">{prompt}</h2>
        </div>
        {children}
      </div>
    </Modal>
  );
}

function Actions({ t, onCancel, onConfirm }: { t: (k: string) => string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
        {t("select.cancel")}
      </button>
      <button type="button" autoFocus onClick={onConfirm} className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">
        {t("select.confirm")}
      </button>
    </div>
  );
}

function collectIds(n: SelectOption): string[] {
  return [n.id, ...(n.children ?? []).flatMap(collectIds)];
}
