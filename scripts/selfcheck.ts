// Self-check for Phase 5 logic: fuzzy matcher + markdown heading extraction.
// Run: node --experimental-strip-types scripts/selfcheck.ts
// (outside tsconfig "src" include, so it never ships in the app bundle)

import assert from "node:assert";
import { fuzzyScore, fuzzySort } from "../src/lib/fuzzy.ts";
import { extractHeadings } from "../src/lib/markdown.ts";

// ---- fuzzy ----

assert.equal(fuzzyScore("sv", "Save"), 4, "sv matches Save (3 start + 1 later)");
assert.equal(fuzzyScore("axz", "Save"), -1, "out-of-order query misses");
assert.equal(fuzzyScore("", "anything"), 0, "empty query matches everything");
assert.equal(fuzzyScore("sve", "Save As"), 3 + 2 + 1 + 1, "consecutive run scores higher");
assert.ok(fuzzyScore("op", "Open File") > fuzzyScore("oe", "Open File"), "subsequence order matters");
assert.deepEqual(
  fuzzySort("s", ["Save As", "Search", "Close Document"], (x) => x),
  ["Save As", "Search", "Close Document"],
  "sort by score, then name",
);

// ---- headings: level, text through inline markup, slug dedup, line ----

const md = [
  "# Title *one*",
  "",
  "intro",
  "",
  "## Section **bold**",
  "",
  "# Title [one](x)",
  "",
  "### Nested `code`",
].join("\n");

const headings = extractHeadings(md);
assert.deepEqual(
  headings.map((h) => ({ level: h.level, text: h.text, slug: h.slug, line: h.line })),
  [
    { level: 1, text: "Title one", slug: "title-one", line: 0 },
    { level: 2, text: "Section bold", slug: "section-bold", line: 4 },
    { level: 1, text: "Title one", slug: "title-one-1", line: 6 },
    { level: 3, text: "Nested code", slug: "nested-code", line: 8 },
  ],
  "heading levels, inline text, slug dedup, and line numbers",
);

// slug used by extractHeadings must match the one the renderer emits
import { renderMarkdown } from "../src/lib/markdown.ts";
const html = renderMarkdown(md);
for (const h of extractHeadings(md)) {
  assert.ok(html.includes(`id="${h.slug}"`), `renderer emits id=${h.slug}`);
}

assert.deepEqual(extractHeadings("no headings here"), [], "no headings -> empty");
assert.deepEqual(extractHeadings("# Only"), [{ level: 1, text: "Only", slug: "only", line: 0 }], "single heading");

// ---- Phase 6: reader position anchors round-trip -------------------------

import {
  readerAnchorFromScroll,
  readerScrollFromAnchor,
  rememberReaderPosition,
  takeReaderPosition,
  rememberEditorPosition,
  takeEditorPosition,
} from "../src/lib/position.ts";

// synthetic layout: headings every 200px of scrollable content, 5 headings
const heads = extractHeadings(
  ["# A", "", "x", "## B", "", "x", "### C", "", "x", "# D", "", "x", "## E"].join("\n"),
);
// heading source lines: 0, 3, 6, 9, 12
assert.deepEqual(heads.map((h) => h.line), [0, 3, 6, 9, 12], "fixture heading lines");
const yAt = (i: number) => i * 200 + 24; // each heading sits 24px into its block
const maxScroll = 1000 + 200; // content = last heading block end

// capture at scrollTop 480 → heading 2 (y 424 <= 528) → source line 7 (1-based)
const anchor = readerAnchorFromScroll(heads, maxScroll, 480, yAt);
assert.equal(anchor.line, 7, "anchor = last heading at/above viewport top + 48");
assert.ok(Math.abs(anchor.frac - 480 / maxScroll) < 1e-9, "anchor keeps fraction fallback");

// restore: same heading returns to ~the same place (y 424 - 24 = 400)
const scroll = readerScrollFromAnchor(heads, anchor, maxScroll, yAt);
assert.equal(scroll, 400, "restore places the anchor heading near the top");

// round-trip: capture(right where we restored) finds the same heading
const back = readerAnchorFromScroll(heads, maxScroll, scroll, yAt);
assert.equal(back.line, 7, "capture(restore(capture)) is stable");

// headingless document → fraction-only, round-trips
const noHeads: typeof heads = [];
const f = readerAnchorFromScroll(noHeads, maxScroll, 800, () => 0);
assert.equal(f.line, 0, "headingless document anchors by fraction only");
assert.equal(readerScrollFromAnchor(noHeads, f, maxScroll, () => 0), 800, "fraction round-trips");

// anchors are stored and retrieved per document path
rememberReaderPosition("C:\\a.md", anchor);
rememberEditorPosition("C:\\a.md", { line: 42, frac: 0.5, cursorLine: 40 });
assert.deepEqual(takeReaderPosition("C:\\a.md"), anchor, "reader anchor keyed by path");
assert.equal(takeEditorPosition("C:\\a.md")?.cursorLine, 40, "editor anchor keyed by path");
assert.equal(takeReaderPosition("C:\\other.md"), null, "unknown path has no anchor");

console.log("selfcheck ok");
