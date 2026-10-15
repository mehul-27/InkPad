// Phase 3: Markdown Reader rendering. One markdown-it instance.
//
// Security: `html: false` means raw HTML in a document is escaped to text,
// so scripts in Markdown can never execute. markdown-it's built-in link
// validation additionally rejects javascript:/data:/vbscript: hrefs.

import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import type { HLJSApi } from "highlight.js";

// Perf (Fix C): highlight.js used to ship as a static import, so its parse
// cost landed on the very first paint. It is now loaded off the critical
// path with a dynamic import (own deferred chunk) — the loader fires at
// module evaluation, usually long before the first render, and every render
// that starts before it arrives degrades gracefully to escaped plain-text
// code fences. The Reader re-runs its memoized render when the highlighter
// lands (loadHighlighter → hljsEpoch bump → memo invalidation below), so
// syntax colors appear the moment the chunk resolves, with no breaking
// change to the synchronous renderMarkdown api.
let hljs: HLJSApi | null = null;
let hljsEpoch = 0;
let hljsPromise: Promise<void> | null = null;

/// Start (once) the off-critical-path load of highlight.js. Always resolves,
/// even if loading fails: without a highlighter, code fences render as
/// escaped plain text instead of throwing.
export function loadHighlighter(): Promise<void> {
  hljsPromise ??= import("highlight.js/lib/common")
    .then((m) => {
      hljs = ((m as { default?: HLJSApi }).default ?? (m as unknown as HLJSApi));
      hljsEpoch++;
    })
    .catch(() => {
      // no highlighter available: future renders keep the plain-text fallback
      hljsPromise = null;
    });
  return hljsPromise;
}

// start the load right away (background work — nothing awaits it)
void loadHighlighter();

const md = new MarkdownIt({
  html: false,
  linkify: false,
  highlight(str: string, lang: string): string {
    // synchronous fallback while highlight.js is not yet loaded (or its
    // load failed): the code is escaped, never dropped, never a crash
    const code =
      hljs && lang && hljs.getLanguage(lang)
        ? hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        : md.utils.escapeHtml(str);
    return `<pre class="hljs"><code>${code}</code></pre>`;
  },
});

md.use(taskLists, { enabled: false, label: false });

// ---- Source-line metadata (Phase 6 regression fix) ------------------------
// Every block-level token carries its own source span (token.map); the
// renderer stamps its 1-based start as data-source-line on the rendered
// element, and the full range table (each block's inclusive last source
// line, derived from token.map) is exposed via sourceLineRanges() — computed
// once per rendered version from the same parse result, so the Reader never
// resolves ranges by DOM ancestry (O(n²) `contains` scanning).
// Nested blocks (li inside ul, p inside li) still carry their own attribute.
const BLOCK_TAGS = new Set([
  "heading_open",
  "paragraph_open",
  "bullet_list_open",
  "ordered_list_open",
  "list_item_open",
  "blockquote_open",
  "table_open",
  "hr",
]);

// ---- Heading anchors (spec §10: heading anchors/IDs) -------------------

const usedSlugs = new Map<string, number>();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface InlineToken {
  type: string;
  content?: string;
  children?: InlineToken[] | null;
}

// Plain text of a heading's inline content, recursing through emphasis /
// strong / links. Used for both anchor slugs and the document outline, so
// outline clicks always resolve to the same heading ids the renderer emits.
function headingText(inline: { children?: InlineToken[] | null } | null): string {
  if (!inline?.children) return "";
  let out = "";
  for (const t of inline.children) {
    if (t.type === "text" || t.type === "code_inline") out += t.content ?? "";
    else if (t.type === "softbreak" || t.type === "hardbreak") out += " ";
    else if (t.children?.length) out += headingText(t);
  }
  return out;
}

const defaultHeadingOpen = md.renderer.rules.heading_open;
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const raw = defaultHeadingOpen
    ? defaultHeadingOpen(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  const text = headingText(tokens[idx + 1]);
  let slug = slugify(text) || "heading";
  const n = usedSlugs.get(slug) ?? 0;
  usedSlugs.set(slug, n + 1);
  if (n > 0) slug = `${slug}-${n}`;
  return raw.replace(/^<(\w+)/, `<$1 id="${slug}"`);
};

// ---- Code blocks: language label + quiet Copy button (spec §11) --------

const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : "";
  const lang = info.split(/\s+/)[0] ?? "";
  const code = defaultFence(tokens, idx, options, env, self);
  const label = lang ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>` : "";
  const srcLine = token.map ? ` data-source-line="${token.map[0] + 1}"` : "";
  return `<div class="code-block"${srcLine}>${label}<button type="button" class="code-copy">Copy</button>${code}</div>`;
};

// ---- Images: InkPad is fully offline (spec §31). Local paths are read by
// ---- a Rust command and delivered as data URLs (resolved in Reader.svelte).
// ---- Remote references render as a placeholder that loads only on an
// ---- explicit click — opening a document never triggers a network request. ----

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = String(token.attrGet("src") ?? "");
  const alt = md.utils.escapeHtml(token.content);
  const title = String(token.attrGet("title") ?? "");
  const titleAttr = title ? ` title="${md.utils.escapeHtml(title)}"` : "";
  if (/^https?:\/\//i.test(src)) {
    const label = alt ? `External image: ${alt} — click to load` : "External image — click to load";
    return `<button type="button" class="remote-image" data-remote-src="${md.utils.escapeHtml(src)}" data-alt="${alt}" title="${md.utils.escapeHtml(src)} — loads over the network on click">${label}</button>`;
  }
  // `loading="lazy"` + `decoding="async"`: the browser defers decoding until
  // the element is painted and decode work stays off the interaction thread.
  // Perf (Fix B): the Reader additionally holds back `src` until the image is
  // near the viewport, so data-local-src images produce no disk/IPC work at
  // all until then; the attribute here is the CSS/DOM-level backstop.
  return `<img data-local-src="${md.utils.escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async"${titleAttr}>`;
};

// Render is memoized keyed on the content string (last-content →
// last-result): renderMarkdown is pure, so identical content must never be
// re-parsed. This is what keeps re-renders of an unchanged content (dirty
// flag / autosave churn in the doc store) ~free.
//
// Per rendered version the very same tokens also yield the block source
// range table below — start and end are both token.map entries, no DOM
// ancestry needed anywhere downstream.
let lastRenderContent: string | null = null;
let lastRenderHtml = "";
let lastRenderRanges: SourceBlockRange[] = [];
// epoch of the highlighter that produced the last render: a render made
// while highlight.js was still loading caches plain-text fences and must be
// re-rendered once the highlighter lands (Fix C)
let lastRenderEpoch = -1;

/// A rendered block's 1-based inclusive source-line range, in document
/// order; index i matches the i-th element carrying data-source-line.
export interface SourceBlockRange {
  start: number;
  end: number;
}

export function renderMarkdown(content: string): string {
  if (content === lastRenderContent && lastRenderEpoch === hljsEpoch) return lastRenderHtml;
  usedSlugs.clear();
  const tokens = md.parse(content, {});
  const ranges: SourceBlockRange[] = [];
  for (const t of tokens) {
    // exactly the tokens that get data-source-line on their rendered
    // element, so sourceLineRanges() and the DOM stay index-aligned
    // (indented code blocks are never stamped, so they stay out too — a
    // neighbouring block's range absorbs their lines, as before)
    if (t.map && (BLOCK_TAGS.has(t.type) || t.type === "fence")) {
      t.attrSet("data-source-line", String(t.map[0] + 1));
      // token.map's exclusive 0-based end IS the block's 1-based inclusive
      // last source line
      ranges.push({ start: t.map[0] + 1, end: t.map[1] });
    }
  }
  lastRenderContent = content;
  lastRenderHtml = md.renderer.render(tokens, md.options, {});
  lastRenderRanges = ranges;
  lastRenderEpoch = hljsEpoch;
  return lastRenderHtml;
}

/// The source ranges for the last render of `content`; computed once per
/// rendered version (cached with the memoized html) and index-aligned with
/// the `.reading-column [data-source-line]` elements in document order.
export function sourceLineRanges(content: string): SourceBlockRange[] {
  if (content !== lastRenderContent) renderMarkdown(content);
  return lastRenderRanges;
}

// ---- Document outline (spec §"Document Outline"): same parser, same slug
// ---- logic as the renderer, so outline entries and heading ids stay in sync.

export interface MarkdownHeading {
  level: number;
  text: string;
  slug: string;
  /** 0-based source line of the heading (token.map start) */
  line: number;
}

export function extractHeadings(content: string): MarkdownHeading[] {
  const used = new Map<string, number>();
  const result: MarkdownHeading[] = [];
  const tokens = md.parse(content, {});
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const text = headingText(tokens[i + 1]);
    let slug = slugify(text) || "heading";
    const n = used.get(slug) ?? 0;
    used.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    result.push({
      level: Number(token.tag[1]),
      text,
      slug,
      line: token.map?.[0] ?? 0,
    });
  }
  return result;
}
