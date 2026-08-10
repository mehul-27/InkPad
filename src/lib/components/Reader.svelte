<script lang="ts">
  import { doc } from "../stores";
  import { renderMarkdown, extractHeadings } from "../markdown";
  import { dirname, resolve } from "@tauri-apps/api/path";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { readImageData } from "../api";
  import { settings } from "../settings";
  import {
    rememberReaderPosition,
    takeReaderPosition,
    readerAnchorFromScroll,
    readerScrollFromAnchor,
    type PositionAnchor,
  } from "../position";

  // Phase 3: rendered Markdown reading pane. Rendering is pure — the doc
  // content is escaped as it renders (html: false), so no document HTML or
  // script ever reaches the DOM. Links are intercepted and handed to the OS.
  // Phase 6: position preservation. The pane remembers a logical anchor
  // (nearest heading's source line, or a normalized scroll fraction) when it
  // unmounts, restores it when it remounts, and re-anchors on live re-render
  // (split view typing, external reloads) instead of jumping to the top.

  const content = $derived($doc?.content ?? "");
  const rendered = $derived.by(() => {
    try {
      return { ok: true as const, html: renderMarkdown(content) };
    } catch (e) {
      return { ok: false as const, error: String(e) };
    }
  });
  const isEmpty = $derived(content.trim() === "");
  // Heading list from the renderer's own parser — order and slugs match the
  // rendered DOM, so heading elements can be mapped to source lines.
  const headings = $derived(
    $doc?.language === "markdown" ? extractHeadings(content) : [],
  );

  let pane: HTMLDivElement | undefined;
  let column: HTMLDivElement | undefined;

  function headingEls(): HTMLElement[] {
    return Array.from(
      pane?.querySelectorAll<HTMLElement>(
        ".reading-column h1, .reading-column h2, .reading-column h3, .reading-column h4",
      ) ?? [],
    );
  }

  /// Content-space y of an element inside the scroller.
  function contentY(el: HTMLElement): number {
    const rect = pane!.getBoundingClientRect();
    return el.getBoundingClientRect().top - rect.top + pane!.scrollTop;
  }

  function captureAnchor(): PositionAnchor | null {
    if (!pane) return null;
    const els = headingEls();
    const maxScroll = pane.scrollHeight - pane.clientHeight;
    return readerAnchorFromScroll(headings, maxScroll, pane.scrollTop, (i) => contentY(els[i]));
  }

  function applyAnchor(anchor: PositionAnchor | null): void {
    if (!anchor || !pane) return;
    const els = headingEls();
    const maxScroll = pane.scrollHeight - pane.clientHeight;
    pane.scrollTop = readerScrollFromAnchor(headings, anchor, maxScroll, (i) => contentY(els[i]));
  }

  // Named-anchor preservation across live re-renders (split view typing):
  // the pre-effect captures which heading was near the top of the viewport
  // (from the DOM about to be replaced), the post-effect re-scrolls so that
  // same heading lands at the same visual offset. Headingless documents
  // fall back to raw scrollTop.
  let preserved: { slug: string | null; topDelta: number; scrollTop: number } | null = null;
  let restored = false;
  let lastPath: string | null = null;

  // watch document switches: when the path changes the pane should restore
  // that document's remembered anchor instead of preserving the old DOM's
  $effect(() => {
    const path = $doc?.path ?? null;
    if (path !== lastPath) {
      lastPath = path;
      restored = false;
    }
  });

  $effect.pre(() => {
    rendered;
    if (!pane || !$doc || !restored) return;
    const els = headingEls();
    const top = pane.scrollTop + 48;
    let idx = -1;
    for (let i = 0; i < els.length; i++) {
      if (contentY(els[i]) <= top) idx = i;
    }
    preserved =
      idx >= 0 && headings[idx]
        ? { slug: headings[idx].slug, topDelta: pane.scrollTop - contentY(els[idx]), scrollTop: pane.scrollTop }
        : { slug: null, topDelta: 0, scrollTop: pane.scrollTop };
  });

  $effect(() => {
    rendered;
    if (!pane || !$doc) return;
    if (!restored) {
      restored = true;
      applyAnchor(takeReaderPosition($doc.path));
      return;
    }
    if (preserved) {
      if (preserved.slug) {
        const el = pane.querySelector<HTMLElement>(`#${CSS.escape(preserved.slug)}`);
        if (el) {
          pane.scrollTop = contentY(el) + preserved.topDelta;
        } else {
          pane.scrollTop = Math.min(preserved.scrollTop, pane.scrollHeight - pane.clientHeight);
        }
      } else {
        pane.scrollTop = Math.min(preserved.scrollTop, pane.scrollHeight - pane.clientHeight);
      }
      preserved = null;
    }
  });

  // remember the logical position when this pane disappears (mode switch,
  // split close, document switch, app teardown)
  $effect(() => {
    $doc;
    const path = $doc?.path;
    return () => {
      if (!path) return;
      try {
        const anchor = captureAnchor();
        if (anchor) rememberReaderPosition(path, anchor);
      } catch {
        // pane already torn down mid-capture; the next visit starts at top
      }
    };
  });

  function decode(src: string): string {
    try {
      return decodeURIComponent(src);
    } catch {
      return src;
    }
  }

  async function absolutePath(src: string): Promise<string | null> {
    const dir = $doc?.path ? await dirname($doc.path) : null;
    if (!dir) return null;
    const rel = decode(src);
    if (/^[a-zA-Z]:[\\/]/.test(rel)) return rel;
    try {
      return await resolve(dir, rel);
    } catch {
      return null;
    }
  }

  async function loadLocalImages(root: HTMLElement): Promise<void> {
    for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img[data-local-src]"))) {
      const src = img.dataset.localSrc ?? "";
      const abs = await absolutePath(src);
      let data = null;
      if (abs) {
        try {
          data = await readImageData(abs);
        } catch {
          data = null;
        }
      }
      if (data) {
        img.src = `data:${data.mime};base64,${data.data}`;
      } else {
        const note = document.createElement("span");
        note.className = "broken-image";
        note.textContent = img.alt ? `[unreadable image: ${img.alt}]` : "[unreadable image]";
        img.replaceWith(note);
      }
    }
  }

  async function copyCode(button: HTMLButtonElement): Promise<void> {
    const block = button.closest(".code-block");
    const code = block?.querySelector("pre")?.innerText ?? "";
    if (!code) return;
    await navigator.clipboard.writeText(code);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1500);
  }

  async function followLink(link: HTMLAnchorElement): Promise<void> {
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const id = href.slice(1);
      column?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // scheme (http, https, mailto, ...) — but not Windows drive letters
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-zA-Z]:[\\/]/.test(href)) {
      openUrl(href);
      return;
    }
    // relative link → resolve against the document folder; .md files come
    // back to InkPad through the file association + single-instance plugin
    const abs = await absolutePath(href);
    if (abs) openUrl(abs);
  }

  // Offline-first: remote images never load on their own. The placeholder
  // button replaces itself with an <img> only when the user clicks it.
  function loadRemoteImage(button: HTMLButtonElement): void {
    const src = button.dataset.remoteSrc;
    if (!src) return;
    const img = document.createElement("img");
    img.src = src;
    img.alt = button.dataset.alt ?? "";
    img.loading = "lazy";
    button.replaceWith(img);
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const remote = target.closest("button.remote-image");
    if (remote) {
      event.preventDefault();
      loadRemoteImage(remote as HTMLButtonElement);
      return;
    }
    const copy = target.closest("button.code-copy");
    if (copy) {
      event.preventDefault();
      void copyCode(copy as HTMLButtonElement);
      return;
    }
    const link = target.closest("a[href]");
    if (link) {
      event.preventDefault();
      void followLink(link as HTMLAnchorElement);
    }
  }

  $effect(() => {
    const el = column;
    if (!el) return;
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  });

  $effect(() => {
    // re-run whenever a (new) document renders
    rendered;
    if (!rendered.ok || isEmpty || !column) return;
    void loadLocalImages(column);
  });
</script>

<div
  class="reading-pane"
  class:wide={$settings.contentWidth === "wide"}
  class:font-small={$settings.readerFontSize === "small"}
  class:font-large={$settings.readerFontSize === "large"}
  bind:this={pane}
>
  <div class="reading-column" bind:this={column}>
    {#if !rendered.ok}
      <p class="doc-message">Couldn't render this document: {rendered.error}</p>
    {:else if isEmpty}
      <p class="doc-message">This document is empty.</p>
    {:else}
      {@html rendered.html}
    {/if}
  </div>
</div>

<style>
  .reading-pane {
    height: 100%;
    overflow-y: auto;
    padding: 48px 32px;
  }

  /* Phase 6: Settings — content width and reader font size */
  .reading-pane.wide .reading-column {
    max-width: 1000px;
  }

  .reading-pane.font-small .reading-column {
    font-size: 15px;
  }

  .reading-pane.font-large .reading-column {
    font-size: 17.5px;
  }

  .reading-column {
    max-width: 800px;
    margin: 0 auto;
    min-height: calc(100% - 96px);
    font-size: 16.5px;
    line-height: 1.75;
    color: var(--prose);
    user-select: text;
    word-break: break-word;
  }

  .doc-message {
    padding: 80px 0;
    text-align: center;
    font-size: 14px;
    color: var(--muted-foreground);
  }

  /* ---- prose ---- */

  .reading-column :global(h1),
  .reading-column :global(h2),
  .reading-column :global(h3),
  .reading-column :global(h4) {
    color: var(--prose-heading);
    line-height: 1.25;
    font-weight: 650;
    scroll-margin-top: 24px;
  }

  .reading-column :global(h1) {
    font-size: 37px;
    margin: 0 0 28px;
  }

  .reading-column :global(h2) {
    font-size: 26px;
    margin: 48px 0 16px;
  }

  .reading-column :global(h3) {
    font-size: 20px;
    margin: 36px 0 12px;
  }

  .reading-column :global(h4) {
    font-size: 17px;
    margin: 28px 0 10px;
  }

  .reading-column :global(p) {
    margin: 0 0 20px;
  }

  .reading-column :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .reading-column :global(a:hover) {
    text-decoration: underline;
  }

  .reading-column :global(strong) {
    color: var(--prose-heading);
    font-weight: 650;
  }

  .reading-column :global(em) {
    font-style: italic;
  }

  .reading-column :global(del) {
    color: var(--muted-foreground);
  }

  /* ---- lists ---- */

  .reading-column :global(ul),
  .reading-column :global(ol) {
    margin: 0 0 20px;
    padding-left: 26px;
  }

  .reading-column :global(li) {
    margin: 4px 0;
  }

  .reading-column :global(li > ul),
  .reading-column :global(li > ol) {
    margin: 4px 0;
  }

  /* task lists */
  .reading-column :global(li.task-list-item) {
    list-style: none;
  }

  .reading-column :global(ul.contains-task-list) {
    padding-left: 20px;
    list-style: none;
  }

  .reading-column :global(input.task-list-item-checkbox) {
    margin: 0 9px 0 0;
    accent-color: var(--accent);
    vertical-align: -1px;
  }

  /* ---- blockquotes ---- */

  .reading-column :global(blockquote) {
    margin: 0 0 20px;
    padding: 2px 0 2px 18px;
    border-left: 3px solid var(--border-strong);
    color: var(--muted-foreground);
  }

  .reading-column :global(blockquote p) {
    margin: 0 0 10px;
  }

  .reading-column :global(blockquote p:last-child) {
    margin-bottom: 0;
  }

  /* ---- tables ---- */

  .reading-column :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 24px;
    font-size: 15px;
  }

  .reading-column :global(th) {
    padding: 8px 12px;
    text-align: left;
    font-weight: 600;
    color: var(--prose-heading);
    border-bottom: 1px solid var(--border-strong);
    white-space: nowrap;
  }

  .reading-column :global(td) {
    padding: 8px 12px;
    border-bottom: 1px solid var(--hairline);
    vertical-align: top;
  }

  .reading-column :global(tbody tr:hover) {
    background: var(--surface);
  }

  /* ---- inline code ---- */

  .reading-column :global(p code),
  .reading-column :global(li code),
  .reading-column :global(td code),
  .reading-column :global(th code) {
    font-family: "JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace;
    font-size: 0.86em;
    background: var(--surface-raised);
    padding: 0.15em 0.42em;
    border-radius: 5px;
  }

  /* ---- code blocks ---- */

  .reading-column :global(.code-block) {
    position: relative;
    margin: 0 0 24px;
    background: var(--code-background);
    border-radius: 8px;
  }

  .reading-column :global(.code-block pre) {
    margin: 0;
    padding: 36px 16px 16px;
    overflow-x: auto;
  }

  .reading-column :global(.code-block code.hljs) {
    font-family: "JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace;
    font-size: 13.5px;
    line-height: 1.65;
    background: transparent;
    padding: 0;
  }

  .reading-column :global(.code-lang) {
    position: absolute;
    top: 8px;
    left: 14px;
    font-family: "JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .reading-column :global(.code-copy) {
    position: absolute;
    top: 6px;
    right: 8px;
    padding: 3px 9px;
    border-radius: 5px;
    font-size: 11.5px;
    color: var(--muted-foreground);
    background: var(--surface-raised);
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .reading-column :global(.code-block:hover .code-copy),
  .reading-column :global(.code-copy:focus-visible) {
    opacity: 1;
  }

  .reading-column :global(.code-copy:hover) {
    color: var(--foreground);
    background: var(--popover);
  }

  /* restrained syntax palette — everything else falls back to --code */
  .reading-column :global(.hljs-comment),
  .reading-column :global(.hljs-quote) {
    color: var(--syntax-comment);
  }

  .reading-column :global(.hljs-keyword),
  .reading-column :global(.hljs-built_in),
  .reading-column :global(.hljs-literal),
  .reading-column :global(.hljs-selector-tag),
  .reading-column :global(.hljs-meta-keyword) {
    color: var(--syntax-keyword);
  }

  .reading-column :global(.hljs-string),
  .reading-column :global(.hljs-meta-string) {
    color: var(--syntax-string);
  }

  .reading-column :global(.hljs-number) {
    color: var(--syntax-number);
  }

  .reading-column :global(.hljs-title),
  .reading-column :global(.hljs-title.function_),
  .reading-column :global(.hljs-function .hljs-title) {
    color: var(--syntax-function);
  }

  /* ---- rules, images, misc ---- */

  .reading-column :global(hr) {
    border: none;
    border-top: 1px solid var(--hairline);
    margin: 36px 0;
  }

  .reading-column :global(img) {
    max-width: 100%;
    border-radius: 8px;
  }

  .reading-column :global(.broken-image) {
    display: block;
    padding: 12px 0;
    font-size: 13px;
    font-style: italic;
    color: var(--muted-foreground);
  }

  .reading-column :global(.remote-image) {
    display: block;
    width: 100%;
    margin: 0 0 24px;
    padding: 16px;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    font-size: 13px;
    font-style: italic;
    color: var(--muted-foreground);
    text-align: center;
    cursor: pointer;
  }

  .reading-column :global(.remote-image:hover) {
    border-color: var(--border);
    color: var(--foreground);
  }
</style>
