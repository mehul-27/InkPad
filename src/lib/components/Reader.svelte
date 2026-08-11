<script lang="ts">
  import { doc } from "../stores";
  import { renderMarkdown } from "../markdown";
  import { dirname, resolve } from "@tauri-apps/api/path";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { readImageData } from "../api";
  import { settings } from "../settings";
  import {
    rememberPosition,
    takePosition,
    anchorFromBlocks,
    scrollFromAnchor,
    VIEWPORT_ANCHOR_FRACTION,
    type PositionAnchor,
    type BlockInfo,
  } from "../position";

  // Phase 3: rendered Markdown reading pane. Rendering is pure — the doc
  // content is escaped as it renders (html: false), so no document HTML or
  // script ever reaches the DOM. Links are intercepted and handed to the OS.
  // Phase 6: position preservation. Every rendered block carries a
  // data-source-line attribute; the pane maps its viewport anchor (25% from
  // the top) to a source line inside the block at that position, remembers
  // it keyed by document path, and restores it by mapping the source line
  // back to a rendered block. Positions are captured continuously while
  // mounted (the DOM is live) — never in teardown, where a detached pane
  // reports zero layout.

  const content = $derived($doc?.content ?? "");
  const rendered = $derived.by(() => {
    try {
      return { ok: true as const, html: renderMarkdown(content) };
    } catch (e) {
      return { ok: false as const, error: String(e) };
    }
  });
  const isEmpty = $derived(content.trim() === "");

  let pane: HTMLDivElement | undefined;
  let column: HTMLDivElement | undefined;

  function totalLines(): number {
    return ($doc?.content.split(/\r\n|\r|\n/).length ?? 0);
  }

  /// Content-space y of an element inside the scroller.
  function contentY(el: HTMLElement): number {
    const rect = pane!.getBoundingClientRect();
    return el.getBoundingClientRect().top - rect.top + pane!.scrollTop;
  }

  /// The rendered blocks in document order with their source ranges.
  /// A block's range ends at the start line of the next block that is not
  /// its descendant (li inside ul, p inside li), or the document's last line.
  function blockInfos(): BlockInfo[] {
    if (!pane) return [];
    const els = Array.from(
      pane.querySelectorAll<HTMLElement>(".reading-column [data-source-line]"),
    );
    const metas = els.map((el) => ({
      el,
      start: Number(el.dataset.sourceLine ?? 0),
      top: contentY(el),
      height: el.getBoundingClientRect().height,
    }));
    const total = totalLines();
    const blocks: BlockInfo[] = [];
    for (let i = 0; i < metas.length; i++) {
      let end = total;
      for (let j = i + 1; j < metas.length; j++) {
        if (!metas[i].el.contains(metas[j].el)) {
          end = metas[j].start - 1;
          break;
        }
      }
      blocks.push({
        start: metas[i].start,
        end: Math.max(metas[i].start, end),
        top: metas[i].top,
        height: metas[i].height,
      });
    }
    return blocks;
  }

  function captureLive(): PositionAnchor | null {
    if (!pane || !pane.isConnected) return null;
    const maxScroll = pane.scrollHeight - pane.clientHeight;
    const anchorY = pane.scrollTop + pane.clientHeight * VIEWPORT_ANCHOR_FRACTION;
    return anchorFromBlocks(blockInfos(), anchorY, maxScroll, pane.scrollTop);
  }

  function applyAnchor(anchor: PositionAnchor | null): void {
    if (!anchor || !pane) return;
    const maxScroll = pane.scrollHeight - pane.clientHeight;
    const targetY = pane.clientHeight * VIEWPORT_ANCHOR_FRACTION;
    pane.scrollTop = scrollFromAnchor(blockInfos(), anchor, targetY, maxScroll);
  }

  // Position anchors are captured continuously while mounted: the pane is
  // live here, so geometry is real. This keeps the per-path anchor fresh for
  // any subsequent mode switch, document switch, or close — teardown never
  // captures (a detached pane reports zero layout).
  let scrollRaf = 0;
  function onScroll(): void {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const path = $doc?.path;
      const anchor = captureLive();
      if (path && anchor) rememberPosition(path, anchor);
    });
  }

  // Named-block preservation across live re-renders (split view typing):
  // the pre-effect captures the block at the viewport anchor (from the DOM
  // about to be replaced), the post-effect re-scrolls so the same source
  // line lands back at that anchor.
  let preserved: PositionAnchor | null = null;
  let restored = false;
  let lastPath: string | null = null;

  // watch document switches: when the path changes the pane should restore
  // that document's remembered anchor instead of preserving the old DOM's
  $effect(() => {
    const path = $doc?.path ?? null;
    if (path !== lastPath) {
      lastPath = path;
      restored = false;
      preserved = null;
    }
  });

  $effect.pre(() => {
    rendered;
    if (!pane || !$doc || !restored) return;
    preserved = captureLive();
  });

  $effect(() => {
    rendered;
    if (!pane || !$doc) return;
    if (!restored) {
      restored = true;
      applyAnchor(takePosition($doc.path));
      // make the map reflect the restored position immediately
      const anchor = captureLive();
      if (anchor) rememberPosition($doc.path, anchor);
      return;
    }
    if (preserved) {
      applyAnchor(preserved);
      preserved = null;
      const anchor = captureLive();
      if (anchor) rememberPosition($doc.path, anchor);
    }
  });

  // continuous capture: scroll + fresh-mount registration
  $effect(() => {
    const el = pane;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    const path = $doc?.path;
    const anchor = captureLive();
    if (path && anchor) rememberPosition(path, anchor);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
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
