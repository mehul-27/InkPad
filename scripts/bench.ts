// InkPad performance benchmark harness (frontend half).
//
// Measures the things the app actually pays for, using the app's own code:
//   - bundle size: total / startup (entry + its static imports) / deferred
//     (dynamically imported) JS bytes, raw and gzip;
//   - parse cost: V8 compile time of the startup chunk set (a proxy for the
//     work the WebView does before the first paint);
//   - markdown pipeline: renderMarkdown + extractHeadings on synthetic
//     documents of realistic size (a large/older document is ~1 MB);
//   - re-render cost: one full re-render per keystroke vs a debounced one;
//   - source-line block ranges: the legacy DOM-ancestry scan (quadratic in
//     block count, one `contains` per pair) against reading the renderer's
//     data-source-line-end attribute.
//
// The native half (startup time, screen open time, scroll frames) lives in
// scripts/bench-native.mjs and drives the built Tauri app over CDP.
//
// Run: node --experimental-strip-types scripts/bench.ts [label]
//   label defaults to "latest"; each run writes scripts/bench-<label>.json
//   and prints a diff against scripts/bench-baseline.json when it exists.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { gzipSync } from "node:zlib";
import { extractHeadings, renderMarkdown, loadHighlighter } from "../src/lib/markdown.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2] ?? "latest";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---- synthetic documents ---------------------------------------------------

const FENCES = ["js", "ts", "python", "rust", "json"];

/// A realistic Markdown document of roughly `targetBytes` bytes: headings,
/// paragraphs, lists, task lists, fenced code (so highlight.js runs), tables
/// and blockquotes — the mix a long README or notes file has.
function syntheticDoc(targetBytes: number): string {
  const parts: string[] = [];
  let bytes = 0;
  let section = 0;
  while (bytes < targetBytes) {
    section++;
    const chunk = [
      `## Section ${section}`,
      "",
      `Paragraph one of section ${section}. It has *emphasis*, **strong text**,`,
      `[a link](https://example.com/${section}) and \`inline code\` so the inline`,
      "parser does real work on every line of the document.",
      "",
      `- First bullet in section ${section}`,
      `- Second bullet with \`code\``,
      `- Third bullet`,
      "",
      `1. Ordered item one`,
      `2. Ordered item two`,
      "",
      `- [ ] Open task ${section}`,
      `- [x] Done task ${section}`,
      "",
      `> A blockquote in section ${section} that spans`,
      `> two source lines.`,
      "",
      "```" + FENCES[section % FENCES.length],
      "function section(input: string) {",
      `  const value = ${section} * 2;`,
      "  return input.repeat(value);",
      "}",
      "```",
      "",
      `### Detail ${section}`,
      "",
      `| column a | column b |`,
      `|---|---|`,
      `| row ${section} | value ${section} |`,
      "",
      `Trailing paragraph for section ${section}.`,
      "",
    ].join("\n");
    parts.push(chunk);
    bytes += chunk.length;
  }
  return parts.join("\n");
}

const SIZES: Array<[string, number]> = [
  ["64kb", 64 * 1024],
  ["256kb", 256 * 1024],
  ["1mb", 1024 * 1024],
];

const docs = new Map<string, string>();
for (const [name, bytes] of SIZES) docs.set(name, syntheticDoc(bytes));

// fixtures for the native harness (never written into the repo)
const fixtureDir = join(tmpdir(), "inkpad-bench");
mkdirSync(fixtureDir, { recursive: true });
for (const [name, text] of docs) {
  writeFileSync(join(fixtureDir, `${name}.md`), text, "utf8");
}

// ---- bundle ---------------------------------------------------------------

function jsFiles(): string[] {
  const dir = join(root, "dist", "assets");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f));
}

function chunkName(file: string): string {
  return file.split(/[\\/]/).pop()!;
}

function staticImports(code: string): string[] {
  const names: string[] = [];
  for (const re of [/from\s*["']\.\/([^"']+)["']/g, /(?:^|[^\w$])import\s*["']\.\/([^"']+)["']/g]) {
    for (const match of code.matchAll(re)) names.push(match[1]);
  }
  return names;
}

function dynamicImports(code: string): string[] {
  const names: string[] = [];
  for (const match of code.matchAll(/import\s*\(\s*["']\.\/([^"']+)["']/g)) names.push(match[1]);
  return names;
}

function bundleMetrics() {
  const html = readFileSync(join(root, "dist", "index.html"), "utf8");
  const entry = /src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
  const files = new Map(jsFiles().map((f) => [chunkName(f), f]));
  const codes = new Map<string, string>();
  for (const [name, file] of files) codes.set(name, readFileSync(file, "utf8"));

  const startup = new Set<string>();
  const queue = entry ? [entry] : [];
  while (queue.length) {
    const name = queue.pop()!;
    if (startup.has(name) || !codes.has(name)) continue;
    startup.add(name);
    queue.push(...staticImports(codes.get(name)!));
  }
  for (const name of [...startup]) {
    for (const dep of dynamicImports(codes.get(name)!)) startup.delete(dep);
  }
  // dynamic chunks pulled in by a startup chunk are deferred, not startup
  for (const name of startup) {
    for (const dep of dynamicImports(codes.get(name)!)) {
      if (startup.has(dep)) startup.delete(dep);
    }
  }

  const sum = (names: Iterable<string>) => {
    let raw = 0;
    let gzip = 0;
    for (const name of names) {
      const code = codes.get(name) ?? "";
      raw += Buffer.byteLength(code);
      gzip += gzipSync(code).length;
    }
    return { bytes: raw, gzip };
  };
  const all = sum(codes.keys());
  const boot = sum(startup);
  const deferred = sum([...codes.keys()].filter((n) => !startup.has(n)));

  // parse proxy: compiling the startup code is what the WebView does before
  // the first paint (module instantiation + evaluation follow). Since the
  // bundle is split into multiple ES module chunks (Fix C), the cross-chunk
  // `import{...}from`/`export{...}` headers are stripped first — vm.Script
  // cannot parse ESM declarations, and their compile cost is negligible;
  // everything else is measured exactly as before.
  const stripModuleDeclarations = (code: string) => {
    return code
      // cross-chunk import declarations (Vite may hoist them mid-file)
      .replace(/\bimport\s*\{[^}]*\}\s*from\s*["'][^"']*["']\s*;/g, "")
      .replace(/\bimport\s*\*\s*as\s*\w+\s*from\s*["'][^"']*["']\s*;/g, "")
      .replace(/\bimport\s*["'][^"']*["']\s*;/g, "")
      // the export table at the end of chunk files
      .replace(/\bexport\s*\{[^}]*\}\s*;?/g, "");
  };
  const parse = (names: Iterable<string>) => {
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      for (const name of names) new Script(stripModuleDeclarations(codes.get(name) ?? ""), { filename: name });
      runs.push(performance.now() - t0);
    }
    return median(runs);
  };

  return {
    entry: entry ?? "",
    startupChunks: [...startup].sort(),
    deferredChunks: [...codes.keys()].filter((n) => !startup.has(n)).sort(),
    totalJsBytes: all.bytes,
    totalJsGzip: all.gzip,
    startupJsBytes: boot.bytes,
    startupJsGzip: boot.gzip,
    deferredJsBytes: deferred.bytes,
    deferredJsGzip: deferred.gzip,
    startupParseMs: round(parse(startup)),
    totalParseMs: round(parse(codes.keys())),
  };
}

// ---- markdown pipeline -----------------------------------------------------

function markdownMetrics() {
  const out: Record<string, unknown> = {};
  for (const [name] of SIZES) {
    const text = docs.get(name)!;
    const sourceKb = Buffer.byteLength(text) / 1024;

    const renderRuns: number[] = [];
    let html = "";
    const reps = name === "1mb" ? 3 : 5;
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      html = renderMarkdown(text);
      renderRuns.push(performance.now() - t0);
    }
    const renderMs = median(renderRuns);

    const headingRuns: number[] = [];
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      extractHeadings(text);
      headingRuns.push(performance.now() - t0);
    }

    out[name] = {
      sourceKb: round(sourceKb, 1),
      htmlKb: round(Buffer.byteLength(html) / 1024, 1),
      renderMs: round(renderMs),
      extractHeadingsMs: round(median(headingRuns)),
      keystrokesWithoutDebounceMs: round(renderMs * 60),
      keystrokesWithDebounceMs: round(renderMs * 6),
      html,
    };
  }
  return out;
}

// ---- source-line block ranges ---------------------------------------------

/// The rendered block elements in document order with their nesting depth,
/// exactly as the Reader's querySelectorAll walk sees them.
function renderedBlocks(html: string): Array<{ start: number; depth: number }> {
  const blocks: Array<{ start: number; depth: number }> = [];
  const depth: string[] = [];
  const voidTags = new Set(["hr", "img", "br", "input"]);
  for (const match of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/g)) {
    const [, closing, tag, attrs] = match;
    if (closing) {
      const i = depth.lastIndexOf(tag);
      if (i >= 0) depth.length = i;
      continue;
    }
    const line = /data-source-line="(\d+)"/.exec(attrs)?.[1];
    if (line) blocks.push({ start: Number(line), depth: depth.length });
    if (!voidTags.has(tag) && !attrs.endsWith("/")) depth.push(tag);
  }
  return blocks;
}

/// Legacy Reader.blockInfos(): for every block scan forward until a block
/// that is not one of its descendants — one `contains` per pair examined.
function legacyRanges(html: string, totalLines: number) {
  const blocks = renderedBlocks(html);
  // emulated containment: the block at j is a descendant of i when the tag
  // depth of j is greater than i's and no shallower block sits in between
  let containsCalls = 0;
  const t0 = performance.now();
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < blocks.length; i++) {
    let end = totalLines;
    for (let j = i + 1; j < blocks.length; j++) {
      containsCalls++;
      const nested = blocks[j].depth > blocks[i].depth || blocks[j].start <= blocks[i].start;
      if (!nested) {
        end = blocks[j].start - 1;
        break;
      }
    }
    ranges.push([blocks[i].start, Math.max(blocks[i].start, end)]);
  }
  return { ranges, containsCalls, ms: performance.now() - t0 };
}

/// New path: every block carries its own source-line range, so the Reader
/// reads two attributes per block and never scans ahead.
function attributeRanges(html: string, totalLines: number) {
  const ranges: Array<[number, number]> = [];
  const t0 = performance.now();
  for (const match of html.matchAll(
    /data-source-line="(\d+)"(?:\s+data-source-line-end="(\d+)")?/g,
  )) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : totalLines;
    ranges.push([start, Math.max(start, end)]);
  }
  return { ranges, containsCalls: 0, ms: performance.now() - t0 };
}

function rangeMetrics(markdown: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [name] of SIZES) {
    const text = docs.get(name)!;
    const html = (markdown[name] as { html: string }).html;
    const totalLines = text.split(/\r\n|\r|\n/).length;
    const legacyRuns: number[] = [];
    const attrRuns: number[] = [];
    let containsCalls = 0;
    let blockCount = 0;
    let legacy: Array<[number, number]> = [];
    for (let i = 0; i < 3; i++) {
      const l = legacyRanges(html, totalLines);
      legacy = l.ranges;
      containsCalls = l.containsCalls;
      blockCount = l.ranges.length;
      legacyRuns.push(l.ms);
      attrRuns.push(attributeRanges(html, totalLines).ms);
    }
    out[name] = {
      blocks: blockCount,
      containsCalls,
      legacyMs: round(median(legacyRuns), 3),
      attributeMs: round(median(attrRuns), 3),
      rangesAgree: JSON.stringify(legacy) === JSON.stringify(attributeRanges(html, totalLines).ranges.filter((_, i) => legacy[i] !== undefined)),
    };
  }
  return out;
}

// ---- report ----------------------------------------------------------------

// Fix C: highlight.js loads on demand inside markdown.ts — make sure it is
// in memory before measuring, so the pipeline numbers stay apples-to-apples
// with the static-import baseline (and the deferred chunk itself is
// measured in bundleMetrics, not here).
await loadHighlighter();

const markdown = markdownMetrics();
const result = {
  label,
  at: new Date().toISOString(),
  fixtures: fixtureDir,
  bundle: bundleMetrics(),
  markdown: Object.fromEntries(
    Object.entries(markdown).map(([name, value]) => {
      const { html, ...rest } = value as { html: string } & Record<string, unknown>;
      return [name, rest];
    }),
  ),
  blockRanges: rangeMetrics(markdown),
};

// strip the rendered HTML before comparing/printing (kept only in memory)
writeFileSync(
  join(root, "scripts", `bench-${label}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
);

const baselinePath = join(root, "scripts", "bench-baseline.json");
let baseline: typeof result | null = null;
if (label !== "baseline") {
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    baseline = null;
  }
}

function line(name: string, before: number | undefined, after: number, unit = ""): string {
  const delta = before === undefined || before === 0 ? "" : `  ${(((after - before) / before) * 100).toFixed(1)}%`;
  const base = before === undefined ? "" : `${before}${unit} -> `;
  return `  ${name.padEnd(34)} ${base}${after}${unit}${delta}`;
}

console.log(`\nInkPad benchmark "${label}"  (fixtures: ${fixtureDir})\n`);
console.log("bundle");
console.log(line("total JS", baseline?.bundle.totalJsBytes, result.bundle.totalJsBytes, " bytes"));
console.log(line("total JS gzip", baseline?.bundle.totalJsGzip, result.bundle.totalJsGzip, " bytes"));
console.log(line("startup JS", baseline?.bundle.startupJsBytes, result.bundle.startupJsBytes, " bytes"));
console.log(line("startup JS gzip", baseline?.bundle.startupJsGzip, result.bundle.startupJsGzip, " bytes"));
console.log(line("deferred JS", baseline?.bundle.deferredJsBytes, result.bundle.deferredJsBytes, " bytes"));
console.log(line("startup chunks", baseline?.bundle.startupChunks.length, result.bundle.startupChunks.length));
console.log(`  startup files                    ${result.bundle.startupChunks.join(", ")}`);
console.log("parse (V8 compile of the startup set)");
console.log(line("startup parse", baseline?.bundle.startupParseMs, result.bundle.startupParseMs, " ms"));
console.log("markdown render / headings");
for (const [name] of SIZES) {
  const after = result.markdown[name] as { renderMs: number; extractHeadingsMs: number };
  const before = baseline?.markdown[name] as { renderMs: number; extractHeadingsMs: number } | undefined;
  console.log(line(`${name} render`, before?.renderMs, after.renderMs, " ms"));
  console.log(line(`${name} headings`, before?.extractHeadingsMs, after.extractHeadingsMs, " ms"));
}
console.log("source-line block ranges");
for (const [name] of SIZES) {
  const after = result.blockRanges[name] as {
    blocks: number;
    containsCalls: number;
    legacyMs: number;
    attributeMs: number;
  };
  const before = baseline?.blockRanges[name] as typeof after | undefined;
  console.log(line(`${name} legacy scan`, before?.legacyMs, after.legacyMs, " ms"));
  console.log(line(`${name} attribute read`, before?.attributeMs, after.attributeMs, " ms"));
  console.log(`  ${name} blocks / contains calls     ${after.blocks} / ${after.containsCalls}`);
}
console.log(`\nwritten: scripts/bench-${label}.json${baseline ? " (diffed against bench-baseline.json)" : ""}`);
