// The one HTML/CSS page builder — turns a layout + images into the self-contained document the render
// port screenshots. Same geometry engine as the user-reviewed mockup gallery: unit coords scale into
// the content box, die-cut cells crop at straight gutter-weight frames, clips carve diagonal seams,
// bleed slots run off the page. `buildPreviewHtml` renders the placeholder mockup style (dotted
// panels, aspect labels, reading-order numbers) for GalleryOptions previews and the settings browser.

import { PAGE } from "./render.ts";
import type { GalleryLayout, LayoutSlot } from "./catalog.ts";

export type Accent = "red" | "blue" | "yellow" | "green" | "purple" | "mono";
export const ACCENTS: Record<Accent, string> = {
  red: "#ff5148",
  blue: "#4da3ff",
  yellow: "#ffd23f",
  green: "#4ade80",
  purple: "#c084fc",
  mono: "#ffffff",
};

// THREE named masthead fields, each with ONE fixed home — title renders big on the left; date is
// the right block's first line, credit its second. Named fields instead of a free-form lines array
// so callers (and models) can't shove the wrong content into the wrong place.
export interface MastheadOpts {
  title?: string;
  date?: string; // right block, line 1 — a date / issue tag
  credit?: string; // right block, line 2 — author / copyright
  accent?: Accent;
}

// Page metrics at render size (scaled 3.75× from the reviewed 560×792 mockups so proportions match).
const M = { margin: 86, mast: 180, gap: 41, border: 11, halo: 19 };

function aspectRatio(a: LayoutSlot["aspect"]): number {
  const [w, h] = a.split(":").map(Number);
  return w / h;
}

// Fit the layout into the content box (bleed slots don't widen the fit past the content edge).
function fit(layout: GalleryLayout, cw: number, ch: number): { k: number; ox: number; oy: number } {
  let maxX = 0;
  let maxY = 0;
  for (const s of layout.slots) {
    const h = s.cell ?? s.w / aspectRatio(s.aspect);
    maxX = Math.max(maxX, s.bleed ? Math.min(s.x + s.w, 1) : s.x + s.w);
    maxY = Math.max(maxY, s.y + h);
  }
  const k = Math.min(cw / maxX, ch / maxY);
  return { k, ox: (cw - maxX * k) / 2, oy: (ch - maxY * k) / 2 };
}

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MAST_FONT = "Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif";

// Inline color markup (post-escape, so raw HTML never passes): [color=#hex]text[/color] → a colored span.
function bbColor(t: string): string {
  return t.replace(/\[color=(#[0-9a-fA-F]{3,8})\](.*?)\[\/color\]/g, '<span style="color:$1">$2</span>');
}

function masthead(opts: MastheadOpts): string {
  // date/credit are SHORT meta lines rendered nowrap beside the title — an unbounded line steals
  // the title's width (the title clips before they do). Hard-capped here so no caller can.
  const lines = [opts.date, opts.credit]
    .map((l) => (l ?? "").trim())
    .filter(Boolean)
    .map((l) => (l.length > 40 ? `${l.slice(0, 39)}…` : l));
  if (!opts.title && !lines.length) return "";
  const accent = ACCENTS[opts.accent ?? "red"];
  const rawTitle = opts.title ?? "";
  const plainLen = rawTitle.replace(/\[color=#[0-9a-fA-F]{3,8}\]|\[\/color\]|\*/g, "").length;
  // Auto-fit: Impact ≈ 0.52em/char; budget ~1500px beside the info block. Shrinks to a 52px floor, then clips —
  // the tool output tells the model to CHECK the render and shorten if cut.
  const fs = Math.max(52, Math.min(97, Math.floor(1500 / Math.max(1, plainLen) / 0.52)));
  const title = bbColor(esc(rawTitle)).replace(/\*([^*]+)\*/g, `<span style="color:${accent}">$1</span>`);
  const details = lines.map((l) => bbColor(esc(l))).join("<br>");
  const hasMarkup = rawTitle.includes("*") || rawTitle.includes("[color=");
  return `<div style="position:absolute;left:${M.margin}px;right:${M.margin}px;top:${M.margin}px;height:${M.mast}px;
    background:#111;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 52px;box-sizing:border-box;gap:40px;">
    <span style="font-family:${MAST_FONT};font-size:${fs}px;letter-spacing:6px;transform:skewX(-6deg);white-space:nowrap;overflow:hidden;flex:0 1 auto;
      border-bottom:${hasMarkup ? "none" : `10px solid ${accent}`};">${title}</span>
    <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;color:#bbb;text-align:right;line-height:1.5;white-space:nowrap;flex:none;">${details}</span>
  </div>`;
}

// Render one slot. `content` is the inner HTML filling the GENERATED box (an <img> or a placeholder).
function slotHtml(s: LayoutSlot, i: number, k: number, ox: number, oy: number, content: (w: number, h: number) => string, preview: boolean): string {
  const px = ox + s.x * k;
  const py = oy + s.y * k;
  const pw = s.w * k;
  const natH = (s.w / aspectRatio(s.aspect)) * k;
  const cellH = (s.cell ?? s.w / aspectRatio(s.aspect)) * k;
  const num = preview ? `<span style="position:absolute;top:0;left:0;width:64px;height:64px;background:#111;color:#fff;font:700 36px/64px ui-monospace,monospace;text-align:center;z-index:3;">${i + 1}</span>` : "";
  if (s.cell) {
    // Die-cut: content (possibly tilted / taller than the cell) is CUT at the straight cell frame.
    const iw = pw * 1.08;
    const ih = iw * (natH / pw);
    const it = s.anchor === "center" ? cellH / 2 - ih / 2 : -ih * 0.02;
    return `<div style="position:absolute;left:${px}px;top:${py}px;width:${pw}px;height:${cellH}px;overflow:hidden;
      border:${M.border}px solid #111;box-sizing:border-box;background:#fff;${s.z ? `z-index:${s.z};` : ""}">
      <div style="position:absolute;left:${(pw - iw) / 2}px;top:${it}px;width:${iw}px;height:${ih}px;${s.rot ? `transform:rotate(${s.rot}deg);` : ""}">${content(iw, ih)}</div>
      ${num}</div>`;
  }
  return `<div style="position:absolute;left:${px}px;top:${py}px;width:${pw}px;height:${natH}px;overflow:hidden;
    border:${M.border}px solid #111;box-sizing:border-box;background:#fff;box-shadow:0 0 0 ${M.halo}px #fff;
    ${s.rot ? `transform:rotate(${s.rot}deg);` : ""}${s.clip ? `clip-path:${s.clip};` : ""}${s.z ? `z-index:${s.z};` : ""}">
    ${content(pw, natH)}${num}</div>`;
}

// The page is always LAID OUT at full A4 pixels; a smaller `out` size wraps it in a scale transform so
// the capture window sees the WHOLE page (previews render small without separate geometry).
function pageShell(body: string, out: { width: number; height: number } = PAGE): string {
  const k = out.width / PAGE.width;
  const inner = `<div style="width:${PAGE.width}px;height:${PAGE.height}px;background:#fff;position:relative;overflow:hidden;transform:scale(${k});transform-origin:top left;">${body}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head>
  <body style="width:${out.width}px;height:${out.height}px;background:#fff;overflow:hidden;">${k === 1 ? body : inner}</body></html>`;
}

// The real page: images (data URLs) fill the slots in reading order.
export function buildPageHtml(layout: GalleryLayout, images: string[], opts: MastheadOpts = {}): string {
  const hasMast = !!(opts.title || opts.date || opts.credit);
  const cw = PAGE.width - M.margin * 2;
  const ch = PAGE.height - M.margin * 2 - (hasMast ? M.mast + M.gap : 0);
  const top = M.margin + (hasMast ? M.mast + M.gap : 0);
  const { k, ox, oy } = fit(layout, cw, ch);
  const slots = layout.slots
    .map((s, i) =>
      slotHtml(s, i, k, M.margin + ox, top + oy, (w, h) =>
        `<img src="${images[i] ?? ""}" style="width:${w}px;height:${h}px;object-fit:cover;display:block;" alt="">`, false),
    )
    .join("");
  return pageShell(masthead(opts) + slots);
}

// The mockup preview: dotted placeholder panels with aspect labels — what GalleryOptions shows.
export function buildPreviewHtml(layout: GalleryLayout, out?: { width: number; height: number }): string {
  const cw = PAGE.width - M.margin * 2;
  const ch = PAGE.height - M.margin * 2 - M.mast - M.gap;
  const top = M.margin + M.mast + M.gap;
  const { k, ox, oy } = fit(layout, cw, ch);
  const slots = layout.slots
    .map((s, i) =>
      slotHtml(s, i, k, M.margin + ox, top + oy, (w, h) =>
        `<div style="width:${w}px;height:${h}px;background-image:radial-gradient(rgba(0,0,0,.10) 4px,transparent 4px);background-size:34px 34px;
          display:flex;align-items:center;justify-content:center;">
          <span style="font-family:${MAST_FONT};font-size:${Math.max(52, Math.min(97, w / 6))}px;color:#444;letter-spacing:4px;background:#fff;padding:4px 30px;">${s.aspect}</span>
        </div>`, true),
    )
    .join("");
  return pageShell(masthead({ title: `LAYOUT *${layout.handle.toUpperCase()}*`, date: `${layout.count} images`, credit: layout.name }) + slots, out);
}
