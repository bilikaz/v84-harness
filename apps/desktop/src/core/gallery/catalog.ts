// The reviewed layout catalog — 26 layouts, 4–8 panels, exported 1:1 from the user-reviewed gallery
// (implementation.md: spacing is king; one wild layout per count; diagonal seams / die-cut cells /
// collide pattern / cinematic crops; no floating insets). Geometry is in fractions of CONTENT WIDTH;
// a slot's natural height = w / aspect; `cell` overrides the visible height (die-cut crop).

export interface LayoutSlot {
  x: number;
  y: number;
  w: number;
  aspect: "16:9" | "4:3" | "1:1" | "3:4" | "9:16"; // what the image model GENERATES for this slot
  rot?: number; // small tilt (wild layouts only)
  clip?: string; // css polygon() — diagonal-cut seams
  z?: number; // stacking for deliberate overlaps (wild layouts only)
  cell?: number; // die-cut cell height (content-width units) — crops the generation, straight frame
  anchor?: "top" | "center"; // which part of a die-cut generation shows (default top)
  bleed?: boolean; // may run off the page edge (page crops it)
}

export interface GalleryLayout {
  id: string; // stable descriptive id ("four-playful")
  handle: string; // the model/user-facing short handle ("4-2") — catalog-ordered, stable
  count: number; // how many images this layout takes
  name: string;
  wild?: boolean; // the one free-form layout of its count (spacing rules relaxed)
  classic?: boolean;
  description: string; // hand-written; ALWAYS rides GalleryOptions output (blind-model support)
  slots: LayoutSlot[]; // reading order
}

// Content-box ratio the geometry was tuned against (A4 page, margins + masthead deducted).
export const CONTENT_RATIO = 1.3366;

const L = (
  id: string,
  count: number,
  name: string,
  description: string,
  slots: LayoutSlot[],
  flags: { wild?: boolean; classic?: boolean } = {},
): Omit<GalleryLayout, "handle"> => ({ id, count, name, description, slots, ...flags });

const S = (x: number, y: number, w: number, aspect: LayoutSlot["aspect"], extra: Partial<LayoutSlot> = {}): LayoutSlot => ({ x, y, w, aspect, ...extra });

const RAW: Omit<GalleryLayout, "handle">[] = [
  // ---- 4 panels ----
  L("four-grid", 4, "grid-classic", "Two tall 9:16 side by side up top, two die-cut squares below — a clean full-width grid.", [
    S(0, 0, 0.4875, "9:16"), S(0.5125, 0, 0.4875, "9:16"),
    S(0, 0.8917, 0.4875, "1:1", { cell: 0.4449, anchor: "center" }), S(0.5125, 0.8917, 0.4875, "1:1", { cell: 0.4449, anchor: "center" }),
  ], { classic: true }),
  L("four-playful", 4, "playful", "Two equal straight squares stacked left; a 9:16 leaning 2° inside its straight die-cut cell right (overhang trimmed, bottoms aligned); a full-width cinematic hero closes.", [
    S(0, 0, 0.43, "1:1"), S(0.455, 0, 0.545, "9:16", { rot: 2, cell: 0.885, anchor: "top" }),
    S(0, 0.455, 0.43, "1:1"), S(0, 0.91, 1.0, "16:9", { cell: 0.4266, anchor: "center" }),
  ]),
  L("four-splash", 4, "splash-rail", "A 3:4 splash holds the left; a 16:9 mirror strip and the 9:16 below it meet on a diagonal-cut seam rising right; a cinematic closer across the bottom.", [
    S(0, 0, 0.61, "3:4"),
    S(0.635, 0, 0.365, "16:9", { clip: "polygon(0 0,100% 0,100% 68%,0 100%)" }),
    S(0.635, 0.1644, 0.365, "9:16", { clip: "polygon(0 10.2%,100% 0,100% 100%,0 100%)" }),
    S(0, 0.8383, 1.0, "16:9", { cell: 0.4983, anchor: "center" }),
  ]),
  L("four-diagonal", 4, "diagonal-cut", "Two full-width wides sliced by a 65/35 diagonal gutter, two straight 4:3 beats below — exact full page.", [
    S(0, 0, 1.0, "16:9", { clip: "polygon(0 0,100% 0,100% 65%,0 100%)" }),
    S(0, 0.3835, 1.0, "16:9", { clip: "polygon(0 35%,100% 0,100% 100%,0 100%)" }),
    S(0, 0.971, 0.4875, "4:3"), S(0.5125, 0.971, 0.4875, "4:3"),
  ]),
  L("four-zigzag", 4, "cine-zigzag", "Four widescreen frames stepping left-right down the page like film cuts — the photo-gallery wall.", [
    S(0, 0, 0.62, "16:9", { rot: -1 }), S(0.36, 0.30, 0.62, "16:9", { rot: 1 }),
    S(0, 0.60, 0.62, "16:9", { rot: -1 }), S(0.36, 0.90, 0.62, "16:9", { rot: 1 }),
  ], { wild: true }),

  // ---- 5 panels ----
  L("five-hero", 5, "hero-quad", "A cinematic-crop hero opens, four straight 4:3 beats in a quad below — exact full page.", [
    S(0, 0, 1.0, "16:9", { cell: 0.5554, anchor: "center" }),
    S(0, 0.5804, 0.4875, "4:3"), S(0.5125, 0.5804, 0.4875, "4:3"),
    S(0, 0.971, 0.4875, "4:3"), S(0.5125, 0.971, 0.4875, "4:3"),
  ]),
  L("five-splash", 5, "splash-rail-five", "A tall 9:16 splash left; two die-cut 3:4 railing right, flush with the splash; two straight 4:3 across the bottom.", [
    S(0, 0, 0.5321, "9:16"),
    S(0.5571, 0, 0.4429, "3:4", { cell: 0.4605, anchor: "center" }), S(0.5571, 0.4855, 0.4429, "3:4", { cell: 0.4605, anchor: "center" }),
    S(0, 0.971, 0.4875, "4:3"), S(0.5125, 0.971, 0.4875, "4:3"),
  ]),
  L("five-x", 5, "x-marks", "Five equal squares thrown into an X — corners pinned to the page corners, the center riding on top, tilted and loosely placed.", [
    S(0, 0.01, 0.43, "1:1", { rot: -4 }), S(0.57, 0, 0.43, "1:1", { rot: 4 }),
    S(0.285, 0.4533, 0.43, "1:1", { rot: -2, z: 2 }),
    S(0.005, 0.8966, 0.43, "1:1", { rot: 3 }), S(0.565, 0.9066, 0.43, "1:1", { rot: -3 }),
  ], { wild: true }),
  L("five-diagonal", 5, "diagonal-hero", "Two full-width wides on a 74/26 diagonal seam, three straight squares closing below — exact full page.", [
    S(0, 0, 1.0, "16:9", { clip: "polygon(0 0,100% 0,100% 74%,0 100%)" }),
    S(0, 0.4324, 1.0, "16:9", { clip: "polygon(0 26%,100% 0,100% 100%,0 100%)" }),
    S(0, 1.0199, 0.3167, "1:1"), S(0.3417, 1.0199, 0.3167, "1:1"), S(0.6833, 1.0199, 0.3167, "1:1"),
  ]),
  L("five-mirror", 5, "mirror-rail", "A 3:4 splash left; the 16:9 mirror strip and 9:16 on the diagonal-cut seam right; two die-cut 3:4 across the bottom.", [
    S(0, 0, 0.61, "3:4"),
    S(0.635, 0, 0.365, "16:9", { clip: "polygon(0 0,100% 0,100% 68%,0 100%)" }),
    S(0.635, 0.1644, 0.365, "9:16", { clip: "polygon(0 10.2%,100% 0,100% 100%,0 100%)" }),
    S(0, 0.8383, 0.4875, "3:4", { cell: 0.4983, anchor: "center" }), S(0.5125, 0.8383, 0.4875, "3:4", { cell: 0.4983, anchor: "center" }),
  ]),
  L("five-heromid", 5, "hero-mid", "Two 4:3 beats, the cinematic hero straight through the middle of the page, two 4:3 beats below — exact full page.", [
    S(0, 0, 0.4875, "4:3"), S(0.5125, 0, 0.4875, "4:3"),
    S(0, 0.3906, 1.0, "16:9", { cell: 0.5554, anchor: "center" }),
    S(0, 0.971, 0.4875, "4:3"), S(0.5125, 0.971, 0.4875, "4:3"),
  ]),

  // ---- 6 panels ----
  L("six-heroes", 6, "heroes-collide", "Two 16:9 halves open; TWO FULL HEROES collide mid-page on a deep 28/72 diagonal slash; two 16:9 halves close — exact full page.", [
    S(0, 0, 0.4875, "16:9"), S(0.5125, 0, 0.4875, "16:9"),
    S(0, 0.2992, 1.0, "16:9", { clip: "polygon(0 0,100% 0,100% 28%,0 100%)" }),
    S(0, 0.4749, 1.0, "16:9", { clip: "polygon(0 72%,100% 0,100% 100%,0 100%)" }),
    S(0, 1.0624, 0.4875, "16:9"), S(0.5125, 1.0624, 0.4875, "16:9"),
  ]),
  L("six-grid", 6, "grid-six", "A 2×3 grid of square generations die-cut into equal cells — the clean sixer, exact full page.", [
    S(0, 0, 0.4875, "1:1", { cell: 0.4289, anchor: "center" }), S(0.5125, 0, 0.4875, "1:1", { cell: 0.4289, anchor: "center" }),
    S(0, 0.4539, 0.4875, "1:1", { cell: 0.4289, anchor: "center" }), S(0.5125, 0.4539, 0.4875, "1:1", { cell: 0.4289, anchor: "center" }),
    S(0, 0.9078, 0.4875, "1:1", { cell: 0.4289, anchor: "center" }), S(0.5125, 0.9078, 0.4875, "1:1", { cell: 0.4289, anchor: "center" }),
  ], { classic: true }),
  L("six-trapezoid", 6, "trapezoid-rows", "Three rows of 4:3 pairs with every vertical gutter slanted the opposite way — exact full page.", [
    S(0, 0, 0.5719, "4:3", { clip: "polygon(0 0,90.9% 0,75.2% 100%,0 100%)" }), S(0.4281, 0, 0.5719, "4:3", { clip: "polygon(20.4% 0,100% 0,100% 100%,4.7% 100%)" }),
    S(0, 0.4539, 0.5719, "4:3", { clip: "polygon(0 0,75.2% 0,90.9% 100%,0 100%)" }), S(0.4281, 0.4539, 0.5719, "4:3", { clip: "polygon(4.7% 0,100% 0,100% 100%,20.4% 100%)" }),
    S(0, 0.9078, 0.5719, "4:3", { clip: "polygon(0 0,90.9% 0,75.2% 100%,0 100%)" }), S(0.4281, 0.9078, 0.5719, "4:3", { clip: "polygon(20.4% 0,100% 0,100% 100%,4.7% 100%)" }),
  ]),
  L("six-splash", 6, "splash-rail-six", "The splash-rail pattern doubled: 3:4 splash + diagonal-seam mirror/tall rail, three die-cut 9:16 across the bottom.", [
    S(0, 0, 0.61, "3:4"),
    S(0.635, 0, 0.365, "16:9", { clip: "polygon(0 0,100% 0,100% 68%,0 100%)" }),
    S(0.635, 0.1644, 0.365, "9:16", { clip: "polygon(0 10.2%,100% 0,100% 100%,0 100%)" }),
    S(0, 0.8383, 0.3167, "9:16", { cell: 0.4983, anchor: "top" }), S(0.3417, 0.8383, 0.3167, "9:16", { cell: 0.4983, anchor: "top" }), S(0.6833, 0.8383, 0.3167, "9:16", { cell: 0.4983, anchor: "top" }),
  ]),
  L("six-cascade", 6, "cascade-six", "Six 4:3 frames tumbling down alternating columns with a gentle gallery tilt.", [
    S(0, 0, 0.46, "4:3", { rot: -1.5 }), S(0.54, 0.1983, 0.46, "4:3", { rot: 1.5 }),
    S(0, 0.3966, 0.46, "4:3", { rot: -1.5 }), S(0.54, 0.595, 0.46, "4:3", { rot: 1.5 }),
    S(0, 0.7933, 0.46, "4:3", { rot: -1.5 }), S(0.54, 0.9916, 0.46, "4:3", { rot: 1.5 }),
  ], { wild: true }),

  // ---- 7 panels ----
  L("seven-collide", 7, "collide-seven", "Two 16:9 halves top; two full heroes colliding on a deep 21/79 slash; three straight squares below — exact full page.", [
    S(0, 0, 0.4875, "16:9"), S(0.5125, 0, 0.4875, "16:9"),
    S(0, 0.2992, 1.0, "16:9", { clip: "polygon(0 0,100% 0,100% 21%,0 100%)" }),
    S(0, 0.4324, 1.0, "16:9", { clip: "polygon(0 79%,100% 0,100% 100%,0 100%)" }),
    S(0, 1.0199, 0.3167, "1:1"), S(0.3417, 1.0199, 0.3167, "1:1"), S(0.6833, 1.0199, 0.3167, "1:1"),
  ]),
  L("seven-hero", 7, "hero-six", "A cinematic hero, then a tidy 3×2 of 3:4 talls — exact full page.", [
    S(0, 0, 1.0, "16:9", { cell: 0.4422, anchor: "center" }),
    S(0, 0.4672, 0.3167, "3:4"), S(0.3417, 0.4672, 0.3167, "3:4"), S(0.6833, 0.4672, 0.3167, "3:4"),
    S(0, 0.9144, 0.3167, "3:4"), S(0.3417, 0.9144, 0.3167, "3:4"), S(0.6833, 0.9144, 0.3167, "3:4"),
  ], { classic: true }),
  L("seven-splash", 7, "splash-rail-seven", "A 3:4 splash; a rail of mirror strip / diagonal-seam square / die-cut 4:3; three die-cut 9:16 across the bottom.", [
    S(0, 0, 0.61, "3:4"),
    S(0.635, 0, 0.365, "16:9", { clip: "polygon(0 0,100% 0,100% 68%,0 100%)" }),
    S(0.635, 0.1646, 0.365, "1:1", { clip: "polygon(0 18%,100% 0,100% 100%,0 100%)" }),
    S(0.635, 0.5546, 0.365, "4:3", { cell: 0.2587, anchor: "center" }),
    S(0, 0.8383, 0.3167, "9:16", { cell: 0.4983, anchor: "top" }), S(0.3417, 0.8383, 0.3167, "9:16", { cell: 0.4983, anchor: "top" }), S(0.6833, 0.8383, 0.3167, "9:16", { cell: 0.4983, anchor: "top" }),
  ]),
  L("seven-checker", 7, "checker", "2 / 3 / 2 — die-cut square pairs bracketing a row of three 3:4 talls — exact full page.", [
    S(0, 0, 0.4875, "1:1", { cell: 0.4322, anchor: "center" }), S(0.5125, 0, 0.4875, "1:1", { cell: 0.4322, anchor: "center" }),
    S(0, 0.4572, 0.3167, "3:4"), S(0.3417, 0.4572, 0.3167, "3:4"), S(0.6833, 0.4572, 0.3167, "3:4"),
    S(0, 0.9044, 0.4875, "1:1", { cell: 0.4322, anchor: "center" }), S(0.5125, 0.9044, 0.4875, "1:1", { cell: 0.4322, anchor: "center" }),
  ]),
  L("seven-rows", 7, "hero-rows", "A near-full hero, a row of three squares, a row of three 3:4 talls — clean escalation, exact full page.", [
    S(0, 0, 1.0, "16:9", { cell: 0.5477, anchor: "center" }),
    S(0, 0.5727, 0.3167, "1:1"), S(0.3417, 0.5727, 0.3167, "1:1"), S(0.6833, 0.5727, 0.3167, "1:1"),
    S(0, 0.9144, 0.3167, "3:4"), S(0.3417, 0.9144, 0.3167, "3:4"), S(0.6833, 0.9144, 0.3167, "3:4"),
  ]),

  // ---- 8 panels ----
  L("eight-grid", 8, "grid-eight", "Three widescreen rows in two columns, closed by a taller die-cut square row — exact full page.", [
    S(0, 0, 0.4875, "16:9"), S(0.5125, 0, 0.4875, "16:9"),
    S(0, 0.2992, 0.4875, "16:9"), S(0.5125, 0.2992, 0.4875, "16:9"),
    S(0, 0.5984, 0.4875, "16:9"), S(0.5125, 0.5984, 0.4875, "16:9"),
    S(0, 0.8976, 0.4875, "1:1", { cell: 0.4391, anchor: "center" }), S(0.5125, 0.8976, 0.4875, "1:1", { cell: 0.4391, anchor: "center" }),
  ], { classic: true }),
  L("eight-manga", 8, "manga-collide", "Three quick 4:3 beats; two full heroes joined mid-page on a 41/59 slash; three quick 4:3 beats — exact full page.", [
    S(0, 0, 0.3167, "4:3"), S(0.3417, 0, 0.3167, "4:3"), S(0.6833, 0, 0.3167, "4:3"),
    S(0, 0.2625, 1.0, "16:9", { clip: "polygon(0 0,100% 0,100% 41%,0 100%)" }),
    S(0, 0.5116, 1.0, "16:9", { clip: "polygon(0 59%,100% 0,100% 100%,0 100%)" }),
    S(0, 1.0991, 0.3167, "4:3"), S(0.3417, 1.0991, 0.3167, "4:3"), S(0.6833, 1.0991, 0.3167, "4:3"),
  ]),
  L("eight-brick", 8, "brick-stagger", "Two staggered columns of wides offset half a step — the photo-gallery wall, doubled.", [
    S(0, 0, 0.4875, "16:9", { rot: -0.7 }), S(0.5125, 0.1521, 0.4875, "16:9", { rot: 0.7 }),
    S(0, 0.2992, 0.4875, "16:9", { rot: -0.7 }), S(0.5125, 0.4513, 0.4875, "16:9", { rot: 0.7 }),
    S(0, 0.5984, 0.4875, "16:9", { rot: -0.7 }), S(0.5125, 0.7505, 0.4875, "16:9", { rot: 0.7 }),
    S(0, 0.8976, 0.4875, "16:9", { rot: -0.7 }), S(0.5125, 1.0497, 0.4875, "16:9", { rot: 0.7 }),
  ], { wild: true }),
  L("eight-rail", 8, "rail-story", "Five die-cut wides stacked left; right column: a 9:16 anchor over two cinematic strips, flush bottom — exact full page.", [
    S(0, 0, 0.4875, "16:9", { cell: 0.2473, anchor: "center" }), S(0, 0.2723, 0.4875, "16:9", { cell: 0.2473, anchor: "center" }),
    S(0, 0.5446, 0.4875, "16:9", { cell: 0.2473, anchor: "center" }), S(0, 0.8169, 0.4875, "16:9", { cell: 0.2473, anchor: "center" }),
    S(0, 1.0892, 0.4875, "16:9", { cell: 0.2473, anchor: "center" }),
    S(0.5125, 0, 0.4875, "9:16"),
    S(0.5125, 0.8917, 0.4875, "16:9", { cell: 0.21, anchor: "center" }), S(0.5125, 1.1267, 0.4875, "16:9", { cell: 0.21, anchor: "center" }),
  ]),
  L("eight-finale", 8, "finale", "Four quick 3:4 beats, three bigger die-cut 3:4, then the huge full widescreen closer — exact full page.", [
    S(0, 0, 0.2313, "3:4"), S(0.2563, 0, 0.2313, "3:4"), S(0.5125, 0, 0.2313, "3:4"), S(0.7688, 0, 0.2313, "3:4"),
    S(0, 0.3333, 0.3167, "3:4", { cell: 0.4158, anchor: "center" }), S(0.3417, 0.3333, 0.3167, "3:4", { cell: 0.4158, anchor: "center" }), S(0.6833, 0.3333, 0.3167, "3:4", { cell: 0.4158, anchor: "center" }),
    S(0, 0.7741, 1.0, "16:9"),
  ]),
];

// Handles are catalog-ordered per count ("4-1", "4-2", …) and stable; custom drop-ins continue the
// numbering after the built-ins.
function withHandles(raw: Omit<GalleryLayout, "handle">[]): GalleryLayout[] {
  const perCount = new Map<number, number>();
  return raw.map((l) => {
    const n = (perCount.get(l.count) ?? 0) + 1;
    perCount.set(l.count, n);
    return { ...l, handle: `${l.count}-${n}` };
  });
}

export const LAYOUTS: GalleryLayout[] = withHandles(RAW);

export function findLayout(idOrHandle: string): GalleryLayout | undefined {
  const key = idOrHandle.trim().toLowerCase();
  return LAYOUTS.find((l) => l.id === key || l.handle === key);
}

export function supportedCounts(): number[] {
  return [...new Set(LAYOUTS.map((l) => l.count))].sort((a, b) => a - b);
}
