// Self-check: fuzzy matcher, markdown heading extraction, and the Phase 6
// logical position-preservation mapping (data-source-line emission, block
// ranges, viewport anchor capture/restore).
// Run: node --experimental-strip-types scripts/selfcheck.ts
// (outside tsconfig "src" include, so it never ships in the app bundle)

import assert from "node:assert";
import { fuzzyScore, fuzzySort } from "../src/lib/fuzzy.ts";
import { extractHeadings, renderMarkdown } from "../src/lib/markdown.ts";
import {
  anchorFromBlocks,
  scrollFromAnchor,
  rememberPosition,
  takePosition,
  VIEWPORT_ANCHOR_FRACTION,
  type BlockInfo,
} from "../src/lib/position.ts";
import {
  DOCUMENT_FORMATS,
  defaultFilename,
  formatById,
  formatForPath,
  isSupportedFile,
  openDialogFilters,
  resolveSaveTarget,
  saveDialogFilters,
} from "../src/lib/docs.ts";

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
const html = renderMarkdown(md);
for (const h of extractHeadings(md)) {
  assert.ok(html.includes(`id="${h.slug}"`), `renderer emits id=${h.slug}`);
}

assert.deepEqual(extractHeadings("no headings here"), [], "no headings -> empty");
assert.deepEqual(extractHeadings("# Only"), [{ level: 1, text: "Only", slug: "only", line: 0 }], "single heading");

// ---- Phase 6 regression: data-source-line on every block type -------------
// The Reader's logical anchors depend on the renderer stamping each rendered
// block with its 1-based source line. Every block type must carry it.

const blocksMd = [
  "# Head",
  "",
  "A paragraph with *inline* markup.",
  "",
  "## Sub",
  "",
  "- item one",
  "  - nested item",
  "- item two",
  "",
  "> quoted",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "---",
  "",
  "last paragraph",
].join("\n");

const blocksHtml = renderMarkdown(blocksMd);
assert.ok(blocksHtml.includes('data-source-line="1"'), "h1 has data-source-line=1");
assert.ok(blocksHtml.includes('<p data-source-line="3">'), "paragraph has data-source-line=3");
assert.ok(blocksHtml.includes('<h2 id="sub" data-source-line="5">'), "h2 has data-source-line=5");
assert.ok(blocksHtml.includes('<ul data-source-line="7">'), "ul has data-source-line=7");
assert.ok(blocksHtml.includes('<li data-source-line="7">'), "list item has data-source-line");
assert.ok(blocksHtml.includes('<blockquote data-source-line="11">'), "blockquote has data-source-line=11");
assert.ok(blocksHtml.includes('data-source-line="13"'), "code block wrapper has data-source-line=13");
assert.ok(blocksHtml.includes('<table data-source-line="17">'), "table has data-source-line=17");
assert.ok(blocksHtml.includes('<hr data-source-line="21"'), "hr has data-source-line=21");
assert.ok(blocksHtml.includes('<p data-source-line="23">'), "trailing paragraph has data-source-line=23");
assert.ok(!blocksHtml.includes('data-source-line="0"'), "no zero-based lines leak into the DOM");

// ---- Phase 6: logical anchor mapping ---------------------------------------
// Real token-derived block ranges for a fixture with all block types, with
// synthetic rendered geometry (top ∝ source position, height ∝ source span —
// the mapping must not depend on the *values*, only on the range structure).
// The DOM glue (querySelectorAll walk) is exercised in the native CDP test;
// the pure mapping here is what the self-check can verify exactly.

const fixture = [
  "# Intro",
  "",
  "long paragraph one",
  "more of it",
  "still more lines",
  "",
  "## Second",
  "",
  "- first item",
  "- second item",
  "",
  "paragraph after list",
  "",
  "> quote",
  "> continued",
  "",
  "```js",
  "const a = 1;",
  "const b = 2;",
  "```",
  "",
  "| x | y |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "## Last",
  "",
  "final words",
].join("\n");

const total = fixture.split("\n").length; // 27

// block source ranges, 1-based inclusive — mirrors Reader.blockInfos()
// (start = data-source-line of each block, end = next non-descendant start-1)
const RANGES: Array<[number, number]> = [
  [1, 1], // h1 "# Intro"
  [3, 5], // paragraph (3 lines)
  [7, 7], // h2 "## Second"
  [9, 10], // ul (2 items)
  [12, 12], // paragraph
  [14, 15], // blockquote
  [17, 19], // code block
  [21, 23], // table
  [25, 25], // h2 "## Last"
  [27, 27], // paragraph
];

// synthetic geometry: content is 2000px tall, each block placed by its
// source position; blocks with a long range are proportionally taller
const scrollHeight = 2000;
const lineSpan = 27;
function makeBlocks(): BlockInfo[] {
  return RANGES.map(([start, end]) => {
    const top = (scrollHeight * (start - 1)) / lineSpan;
    const height = Math.max(20, (scrollHeight * (end - start + 1)) / lineSpan);
    return { start, end, top, height };
  });
}

const clientHeight = 600;
const maxScroll = scrollHeight - clientHeight; // 1400
const targetY = clientHeight * VIEWPORT_ANCHOR_FRACTION; // 150

function anchorAt(scrollTop: number) {
  const blocks = makeBlocks();
  return anchorFromBlocks(blocks, scrollTop + targetY, maxScroll, scrollTop);
}

// anchor line must always land inside the block at the anchor position
{
  const blocks = makeBlocks();
  for (const b of blocks) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const y = b.top + b.height * t;
      const anchor = anchorFromBlocks(blocks, y, maxScroll, 0);
      assert.ok(
        anchor.line >= b.start && anchor.line <= b.end,
        `anchor at block [${b.start},${b.end}] frac=${t} lands inside (got ${anchor.line})`,
      );
    }
  }
}

// restore: the anchor line lands back at the same viewport fraction
{
  const blocks = makeBlocks();
  const anchor = anchorFromBlocks(blocks, 0 + targetY, maxScroll, 0);
  const back = scrollFromAnchor(blocks, anchor, targetY, maxScroll);
  assert.equal(back, 0, "restore at document top scrolls to 0");
  const mid = anchorAt(maxScroll * 0.5);
  const midScroll = scrollFromAnchor(makeBlocks(), mid, targetY, maxScroll);
  assert.ok(Math.abs(midScroll - maxScroll * 0.5) < 120, `mid-document round-trip is stable (${midScroll})`);
  const bottom = anchorAt(maxScroll);
  const bottomScroll = scrollFromAnchor(makeBlocks(), bottom, targetY, maxScroll);
  assert.ok(Math.abs(bottomScroll - maxScroll) < 120, "bottom round-trip is stable");
}

// 10/25/50/75/90 matrix: capture at a scroll fraction → restore → re-capture
// must return to (approximately) the same logical line, not drift
{
  const marks = [0.1, 0.25, 0.5, 0.75, 0.9];
  for (const frac of marks) {
    const a1 = anchorAt(maxScroll * frac);
    const s1 = scrollFromAnchor(makeBlocks(), a1, targetY, maxScroll);
    const a2 = anchorFromBlocks(makeBlocks(), s1 + targetY, maxScroll, s1);
    const drift = Math.abs(a2.line - a1.line);
    assert.ok(drift <= 2, `matrix ${frac * 100}% stable (${a1.line} -> ${a2.line}, drift ${drift})`);
  }
}

// editor-side exact line mapping (CodeMirror): a source line maps to itself
{
  const blocks = makeBlocks();
  const anchor = anchorAt(maxScroll * 0.5);
  const s = scrollFromAnchor(blocks, anchor, targetY, maxScroll);
  const recaptured = anchorFromBlocks(makeBlocks(), s + targetY, maxScroll, s);
  assert.ok(Math.abs(recaptured.line - anchor.line) <= 2, "capture(restore) keeps the line");
}

// fraction-only fallback: empty block list (e.g. empty doc) round-trips
{
  const a = anchorFromBlocks([], 100, maxScroll, 800);
  assert.equal(a.line, 0, "no blocks -> line 0");
  assert.ok(Math.abs(a.frac - 800 / maxScroll) < 1e-9, "no blocks -> fraction");
  const back = scrollFromAnchor([], a, targetY, maxScroll);
  assert.ok(Math.abs(back - 800) < 1e-9, "fraction fallback round-trips");
}

// anchors are stored and retrieved per document path (shared Reader/Editor map)
{
  const a = { line: 950, frac: 0.5, cursorLine: 940 };
  rememberPosition("C:\\a.md", a);
  assert.deepEqual(takePosition("C:\\a.md"), a, "anchor keyed by path");
  assert.equal(takePosition("C:\\other.md"), null, "unknown path has no anchor");
}

// ---- centralized format registry ------------------------------------------
// Every supported extension maps to exactly one format, unsupported files are
// rejected, and the native dialog filters / default names / save-path
// resolution all derive from that single source.

{
  // no extension is claimed by two formats
  const seen = new Map<string, string>();
  for (const format of DOCUMENT_FORMATS) {
    assert.ok(format.extensions.length > 0, `${format.id} has an extension`);
    for (const ext of format.extensions) {
      assert.ok(!seen.has(ext), `extension "${ext}" is claimed once`);
      seen.set(ext, format.id);
    }
  }

  const cases: Array<[string, string | undefined]> = [
    ["notes.md", "markdown"],
    ["A.MARKDOWN", "markdown"],
    ["readme.txt", "plaintext"],
    ["app.log", "log"],
    ["setup.ini", "ini"],
    [".env", "ini"],
    ["data.json", "json"],
    ["config.yaml", "yaml"],
    ["config.yml", "yaml"],
    ["cargo.toml", "toml"],
    ["feed.xml", "xml"],
    ["rows.csv", "csv"],
    ["index.html", "html"],
    ["legacy.htm", "html"],
    ["styles.css", "css"],
    ["app.jsx", "javascript"],
    ["module.mjs", "javascript"],
    ["types.ts", "typescript"],
    ["view.tsx", "typescript"],
    ["script.py", "python"],
    ["main.cpp", "cpp"],
    ["lib.h", "cpp"],
    ["Main.java", "java"],
    ["lib.rs", "rust"],
    ["main.go", "go"],
    ["query.sql", "sql"],
    ["photo.png", undefined],
    ["archive.zip", undefined],
    ["noextension", undefined],
  ];
  for (const [path, id] of cases) {
    assert.equal(formatForPath(path)?.id, id, `format of ${path}`);
  }

  assert.equal(isSupportedFile("README.md"), true, "supported file");
  assert.equal(isSupportedFile("image.png"), false, "unsupported file");
  assert.equal(isSupportedFile("noextension"), false, "extensionless unsupported");

  // default generated filename per format
  for (const [id, name] of [
    ["markdown", "Untitled.md"],
    ["plaintext", "Untitled.txt"],
    ["python", "Untitled.py"],
    ["json", "Untitled.json"],
    ["html", "Untitled.html"],
  ] as const) {
    assert.equal(defaultFilename(formatById(id)!), name, `default name for ${id}`);
  }
}

// ---- save-target resolution (extension is the source of truth) -------------

{
  const markdown = formatById("markdown")!;
  const python = formatById("python")!;
  const json = formatById("json")!;

  // recognised extension: format follows the file, path is untouched
  assert.deepEqual(
    resolveSaveTarget("C:\\notes.json", markdown),
    { path: "C:\\notes.json", format: json },
    "extension overrides the originating format",
  );
  // no extension: appended from the document's format, never doubled
  assert.deepEqual(resolveSaveTarget("C:\\script", python), { path: "C:\\script.py", format: python });
  assert.deepEqual(resolveSaveTarget("C:\\notes", markdown), { path: "C:\\notes.md", format: markdown });
  assert.deepEqual(resolveSaveTarget("C:\\notes.py", python), { path: "C:\\notes.py", format: python });
  assert.deepEqual(resolveSaveTarget("C:\\trailing.", markdown), { path: "C:\\trailing.md", format: markdown });
  // unknown extension is refused rather than saved with a misleading type
  assert.equal(resolveSaveTarget("C:\\notes.xyz", python), null, "unknown extension rejected");
  assert.equal(resolveSaveTarget("   ", python), null, "blank path rejected");
}

// ---- dialog filters come from the registry --------------------------------

{
  const filters = openDialogFilters();
  assert.equal(filters[0].name, "All Supported Files", "all-supported first");
  assert.equal(filters[filters.length - 1].name, "All Files", "all-files last");
  const python = filters.find((f) => f.name === "Python");
  assert.deepEqual(python?.extensions, ["py"], "Python filter group");
  const data = filters.find((f) => f.name === "Data");
  assert.ok(data?.extensions.includes("json") && data?.extensions.includes("yaml"), "Data filter group");

  // save dialog: the document's own format is the default filter (so the
  // native "Save as type" dropdown shows it and the default extension is
  // right), and All Supported Files is still offered
  const yamlSave = saveDialogFilters(formatById("yaml")!);
  assert.equal(yamlSave[0].name, "YAML", "save defaults to the document's format");
  assert.deepEqual(
    yamlSave[0].extensions,
    formatById("yaml")!.extensions,
    "save default filter is the format's own extensions",
  );
  assert.equal(yamlSave[0].extensions[0], "yaml", "save default extension follows the format");
  assert.ok(yamlSave.some((f) => f.name === "All Supported Files"), "all-supported still offered");
  assert.equal(yamlSave[yamlSave.length - 1].name, "All Files", "save all-files last");
  assert.equal(savedDefault(saveDialogFilters(formatById("python")!)), "py", "python save default extension");
  assert.equal(savedDefault(saveDialogFilters(formatById("markdown")!)), "md", "markdown save default extension");

  // no duplicate filter entries (a single-format group must not repeat it)
  for (const id of ["markdown", "python", "ini", "json", "plaintext"]) {
    const names = saveDialogFilters(formatById(id)!).map((f) => f.name);
    assert.equal(new Set(names).size, names.length, `save filter names unique for ${id}`);
  }

  function savedDefault(list: ReturnType<typeof saveDialogFilters>): string {
    return list[0].extensions[0];
  }
}

console.log("selfcheck ok");
