// The Cancel / Confirm button pair every confirmation (popover or modal)
// repeats. The container stays with the caller — only the footer is shared.
export function ConfirmActions(props: {
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <div className={props.className ?? "mt-3 flex justify-end gap-2"}>
      <button
        type="button"
        onClick={props.onCancel}
        className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
      >
        {props.cancelLabel}
      </button>
      <button
        type="button"
        onClick={props.onConfirm}
        className={
          props.danger
            ? "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
            : "rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        }
      >
        {props.confirmLabel}
      </button>
    </div>
  );
}
