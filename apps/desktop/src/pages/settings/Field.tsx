import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

// The width- and border-color-free core, for callers that override either
// (e.g. a validation-error red border).
export const fieldInputBare = "rounded-lg border px-3 py-1.5 text-sm outline-none";

const base = `${fieldInputBare} border-neutral-200 focus:border-neutral-400`;

export const fieldInput = `w-72 ${base}`;
// The flex-sized variant, for inputs/selects sharing a row with a button.
export const fieldInputFlex = `min-w-0 flex-1 ${base}`;
// Full-width variant (workspace settings panel).
export const fieldInputFull = `w-full ${base}`;

export function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-4">
      <span className="text-sm text-neutral-700">{props.label}</span>
      {props.children}
    </div>
  );
}

// The "Detect models" probe button (Settings → Provider / Media): spinner while
// busy, disabled while busy or when the endpoint isn't configured yet.
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
