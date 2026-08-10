// Phase 6: reading/edit position preservation. The Reader and the Editor
// have different line heights and layouts, so raw scroll offsets are never
// reused across panes. Instead each pane remembers a *logical* location
// (nearest source line, heading line, normalized scroll fraction) keyed by
// document path, and the other pane restores approximately that location
// when it mounts. Anchors survive mode switches; per-path keys even survive
// round-trips through other files within the session.

export interface PositionAnchor {
  /** heading line or editor's top visible line (1-based source line). */
  line: number;
  /** Fallback: normalized scroll fraction 0..1 for headingless documents. */
  frac: number;
  /** Editor cursor line (1-based); absent for reader anchors. */
  cursorLine?: number | null;
}

const readerAnchors = new Map<string, PositionAnchor>();
const editorAnchors = new Map<string, PositionAnchor>();

export function rememberReaderPosition(path: string, anchor: PositionAnchor): void {
  readerAnchors.set(path, anchor);
}

export function takeReaderPosition(path: string): PositionAnchor | null {
  return readerAnchors.get(path) ?? null;
}

export function rememberEditorPosition(path: string, anchor: PositionAnchor): void {
  editorAnchors.set(path, anchor);
}

export function takeEditorPosition(path: string): PositionAnchor | null {
  return editorAnchors.get(path) ?? null;
}

// ---- pure mapping helpers (unit-tested in scripts/selfcheck.ts) ---------

import type { MarkdownHeading } from "./markdown";

/** Viewport "at or above" tolerance used when picking the anchor heading. */
const TOP_TOLERANCE = 48;

/** The heading the reader is viewing: the last heading at or above the top
 *  of the viewport (headingY(i) = content-space y of the i-th rendered
 *  heading element, in the same order as `headings`). Headingless documents
 *  fall back to a normalized scroll fraction. */
export function readerAnchorFromScroll(
  headings: MarkdownHeading[],
  maxScroll: number,
  scrollTop: number,
  headingY: (i: number) => number,
): PositionAnchor {
  const top = scrollTop + TOP_TOLERANCE;
  let idx = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headingY(i) <= top) idx = i;
  }
  const frac = maxScroll > 0 ? Math.min(1, Math.max(0, scrollTop / maxScroll)) : 0;
  return idx >= 0 && headings[idx]
    ? { line: headings[idx].line + 1, frac }
    : { line: 0, frac };
}

/** Scroll position that shows approximately what an anchor referred to:
 *  the anchor's heading placed near the top of the viewport, or the stored
 *  fraction when the heading no longer maps. */
export function readerScrollFromAnchor(
  headings: MarkdownHeading[],
  anchor: PositionAnchor,
  maxScroll: number,
  headingY: (i: number) => number,
): number {
  if (anchor.line > 0) {
    const idx = headings.findIndex((h) => h.line + 1 === anchor.line);
    if (idx >= 0 && headingY(idx) >= 0) {
      return Math.max(0, headingY(idx) - TOP_TOLERANCE / 2);
    }
  }
  return anchor.frac * Math.max(maxScroll, 0);
}