// Phase 3: Markdown Reader rendering. One markdown-it instance.
//
// Security: `html: false` means raw HTML in a document is escaped to text,
// so scripts in Markdown can never execute. markdown-it's built-in link
// validation additionally rejects javascript:/data:/vbscript: hrefs.

import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/common";

const md = new MarkdownIt({
  html: false,
  linkify: false,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre class="hljs"><code>${hljs
        .highlight(str, { language: lang, ignoreIllegals: true })
        .value}</code></pre>`;
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(taskLists, { enabled: false, label: false });

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

function headingText(
  inline: { children?: { type: string; content: string }[] | null } | null,
): string {
  if (!inline?.children) return "";
  return inline.children
    .filter((t) => t.type === "text" || t.type === "code_inline")
    .map((t) => t.content)
    .join("");
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
  return `<div class="code-block">${label}<button type="button" class="code-copy">Copy</button>${code}</div>`;
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
  return `<img data-local-src="${md.utils.escapeHtml(src)}" alt="${alt}" loading="lazy"${titleAttr}>`;
};

export function renderMarkdown(content: string): string {
  usedSlugs.clear();
  return md.render(content);
}
