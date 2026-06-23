import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "../../lib/cn.ts";

export const fieldInputBare = "rounded-lg border px-3 py-1.5 text-sm outline-none";

const base = `${fieldInputBare} border-neutral-200 focus:border-neutral-400`;

export const fieldInput = `w-80 ${base}`;
export const fieldInputFlex = `min-w-0 flex-1 ${base}`;
export const fieldInputFull = `w-full ${base}`;

export function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-4">
      <span className="text-sm text-neutral-700">{props.label}</span>
      {props.children}
    </div>
  );
}

// A slide toggle — the shared on/off control for settings + plugin switches (replaces bare checkboxes).
export function Switch(props: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      disabled={props.disabled}
      onClick={props.onToggle}
      className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50", props.on ? "bg-neutral-900" : "bg-neutral-300")}
    >
      <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform", props.on ? "translate-x-4" : "translate-x-0")} />
    </button>
  );
}

export function DetectButton(props: { label: string; busy: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.busy || props.disabled}
      title={props.title}
      className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
    >
      <RefreshCw size={14} className={props.busy ? "animate-spin" : ""} />
      {props.label}
    </button>
  );
}