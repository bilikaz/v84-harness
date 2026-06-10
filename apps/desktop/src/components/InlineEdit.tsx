import { cn } from "../lib/cn.ts";

// Inline rename input: Enter commits, Escape cancels, blur commits. Shared by
// the session-title rename (header) and the sidebar's session rename.
export function InlineEdit(props: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <input
      autoFocus
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onCommit();
        else if (e.key === "Escape") props.onCancel();
      }}
      onBlur={props.onCommit}
      className={cn("rounded-md text-sm outline-none ring-1 ring-neutral-300", props.className)}
    />
  );
}
