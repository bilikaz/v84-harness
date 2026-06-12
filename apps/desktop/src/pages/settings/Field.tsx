import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

// Width- and border-color-free core, for callers that override either (e.g. a validation-error red border).
export const fieldInputBare = "rounded-lg border px-3 py-1.5 text-sm outline-none";

const base = `${fieldInputBare} border-neutral-200 focus:border-neutral-400`;

// One width (w-80) for every settings field so columns line up across sections.
export const fieldInput = `w-80 ${base}`;
// Flex-sized variant, for inputs/selects sharing a w-80 row with a button.
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
