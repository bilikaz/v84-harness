// The gallery render PORT — core defines it, the platform injects the implementation (capability
// injection, same shape as the browser fleet split). Electron main sets an offscreen-BrowserWindow
// renderer at tool-registry construction; without an injection (web, tests) rendering is unavailable
// and the gallery tools report canRun() = false.

export interface PageRenderer {
  // Render a self-contained HTML document at EXACT pixel size and return a PNG data URL.
  (html: string, size: { width: number; height: number }): Promise<string>;
}

let renderer: PageRenderer | null = null;

export function setPageRenderer(fn: PageRenderer): void {
  renderer = fn;
}

export function hasPageRenderer(): boolean {
  return renderer != null;
}

export function renderPage(html: string, size: { width: number; height: number }): Promise<string> {
  if (!renderer) return Promise.reject(new Error("page rendering is not available on this platform"));
  return renderer(html, size);
}

// The one page format: A4 portrait at 10 px/mm (~2k×3k — print-quality without bloat). No Letter
// variant by decision: printers fit/margin A4 output themselves.
export const PAGE = { width: 2100, height: 2970 } as const;
