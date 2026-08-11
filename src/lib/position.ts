// Phase 6 position preservation (regression fix): a *logical* source-line
// anchor, shared between the Reader and the Editor. Reader and Editor have
// different line heights, wrapping, block heights, and margins, so pixels and
// scroll ratios are never mapped between panes. The two panes agree only on
// the Markdown source itself:
//
//   - the Reader stamps every rendered block with data-source-line
//     (markdown.ts), so a viewport position maps to the block that contains
//     the viewport anchor and to a source line *within* that block;
//   - the Editor maps source lines to CodeMirror positions exactly;
//   - both panes capture positions *while mounted* (the DOM is live) — never
//     at teardown, where detached elements report zero layout;
//   - both panes restore the source line to the same viewport fraction
//     (VIEWPORT_ANCHOR_FRACTION from the top), preserving relative position
//     when block heights differ between renders.
//
// The normalized scroll fraction remains only as a last-resort fallback for
// documents where source-line mapping is impossible (no blocks, or the
// anchor's block no longer exists).

export interface PositionAnchor {
  /** 1-based source line at the viewport anchor. 0 = unknown (fraction-only). */
  line: number;
  /** Fallback: normalized scroll fraction 0..1 (top..bottom). */
  frac: number;
  /** Editor cursor line (1-based); absent for reader anchors. */
  cursorLine?: number | null;
}

/** Where the viewport anchor sits: 25% from the top (within the top third). */
export const VIEWPORT_ANCHOR_FRACTION = 0.25;

const positions = new Map<string, PositionAnchor>();

export function rememberPosition(path: string, anchor: PositionAnchor): void {
  positions.set(path, anchor);
}

export function takePosition(path: string): PositionAnchor | null {
  return positions.get(path) ?? null;
}

// ---- pure mapping helpers (unit-tested in scripts/selfcheck.ts) -----------

/** A rendered block: its source line range and its rendered geometry
 *  (top/height in content space, i.e. relative to the scroller origin). */
export interface BlockInfo {
  /** 1-based source line of the block's first line. */
  start: number;
  /** 1-based source line of the block's last line (inclusive). */
  end: number;
  /** y of the block's top edge in the scroller's content space. */
  top: number;
  /** rendered height in px. */
  height: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Capture: which source line sits at the viewport anchor (`anchorY` in
 *  content space)? The block containing the anchor is found first, then the
 *  line is interpolated across its source range — layout-independent. */
export function anchorFromBlocks(
  blocks: BlockInfo[],
  anchorY: number,
  maxScroll: number,
  scrollTop: number,
): PositionAnchor {
  const frac = maxScroll > 0 ? clamp01(scrollTop / maxScroll) : 0;
  if (blocks.length === 0) return { line: 0, frac };
  let idx = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].top <= anchorY) idx = i;
  }
  if (idx < 0) idx = 0; // anchor above the first block
  const b = blocks[idx];
  const within = b.height > 0 ? clamp01((anchorY - b.top) / b.height) : 0;
  const line = b.start + Math.round(within * (b.end - b.start));
  return { line, frac };
}

/** Restore: the scroll position that places `anchor.line` at
 *  `targetY` (viewport fraction, in px) — the same anchor position the
 *  capture used. Falls back to the stored scroll fraction when the line
 *  maps to no block. */
export function scrollFromAnchor(
  blocks: BlockInfo[],
  anchor: PositionAnchor,
  targetY: number,
  maxScroll: number,
): number {
  const fallback = () => clamp01(anchor.frac) * Math.max(maxScroll, 0);
  if (blocks.length === 0 || anchor.line < 1) return fallback();
  const b = findBlock(blocks, anchor.line);
  if (!b) return fallback();
  const span = b.end - b.start;
  const within = span > 0 ? clamp01((anchor.line - b.start) / span) : 0;
  return clamp01((b.top + within * b.height - targetY) / Math.max(maxScroll, 0)) * maxScroll;
}

/** The block whose source range contains `line`; the nearest edge block when
 *  the line lies outside every range; null only when blocks is empty. */
function findBlock(blocks: BlockInfo[], line: number): BlockInfo | null {
  let last = blocks[0];
  for (const b of blocks) {
    if (b.start <= line && line <= b.end) return b;
    if (b.start > line) break;
    last = b;
  }
  return last ?? null;
}
