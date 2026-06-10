import { useEffect, useState, type RefObject } from "react";

// Bind Escape → callback while `active`. Shared by Modal, Lightbox, and menus.
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

// Dismiss a menu/popover when clicking anywhere outside `ref`, while `active`.
export function useOutsideClick(active: boolean, ref: RefObject<HTMLElement | null>, onOutside: () => void): void {
  useEffect(() => {
    if (!active) return;
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

// The detect/test-endpoint button pattern (Settings → Provider / Media): a
// busy flag + result message around an async probe returning {ok, count, error}.
export function useDetection(
  probe: () => Promise<{ ok: boolean; count: number; error?: string }>,
  format: (r: { ok: boolean; count: number; error?: string }) => string,
): { detecting: boolean; msg: string; detect: () => Promise<void> } {
  const [detecting, setDetecting] = useState(false);
  const [msg, setMsg] = useState("");
  async function detect(): Promise<void> {
    if (detecting) return;
    setDetecting(true);
    setMsg("");
    const r = await probe();
    setDetecting(false);
    setMsg(format(r));
  }
  return { detecting, msg, detect };
}
