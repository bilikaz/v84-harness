import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "../lib/cn.ts";
import { useEscapeKey } from "../lib/hooks.ts";

// Centered modal: backdrop, ESC, top-right close button. Panel sizing via className.
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const { open, onClose, children, className } = props;
  const { t } = useTranslation();
  useEscapeKey(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative rounded-2xl bg-white shadow-2xl ring-1 ring-black/5",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-4 top-4 z-10 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
