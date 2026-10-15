<script lang="ts">
  import { doc, mode } from "../stores";
  import { sourceLineRanges, renderMarkdown, loadHighlighter } from "../markdown";
  import { readImageData } from "../api";
  import { dirname, resolve } from "@tauri-apps/api/path";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { cachedImage, loadImageFromDisk } from "../local-images";
  import { settings } from "../settings";
  import {
    rememberPosition,
    takePosition,
    anchorFromBlocks,
    scrollFromAnchor,
    VIEWPORT_ANCHOR_FRACTION,
    type PositionAnchor,
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
  //
  // Perf (Fix A):
  //   - renderMarkdown itself is memoized keyed on the content string, and
  //     the pane renders a `lagged` copy of the doc content rather than the
  //     store value, so doc churn that doesn't change content (dirty flag,
  //     autosave) never re-runs the pipeline at all;
  //   - in split view the lag is capped at `debounceMs` (trailing render), so
  //     a keystroke never triggers a full parse on the same frame; document
  //     switches, mode changes and reading mode render instantly;
  //   - block source ranges are computed once per rendered version from the
  //     parse result (sourceLineRanges()) and cached; scroll frames do a
  //     monotone binary search over block rects (~log n rect reads), and the
  //     legacy DOM-ancestry fallback runs only once per rendered version.

  /// Max ms the rendered pane lags behind typing in split view; 0 = always
  /// instant (reading mode, document switch, mode change).
  ///
  /// Fix D: `visible` tracks the hosting pane's display:none (DocumentPane
  /// keeps this component mounted across mode toggles so its HTML never has
  /// to be rebuilt). A hidden pane has no live geometry, so position capture
  /// and anchor restore are gated on it; the next show re-adopts the shared
  /// anchor exactly as a fresh mount did.
  let {
    debounceMs = 0,
    visible = true,
  }: { debounceMs?: number; visible?: boolean } = $props();

  // The doc store changes synchronously on every edit, so this subscriber is
  // where the rendered copy (`lagged`) is fed: switches are pushed instantly,
  // same-document edits in split view are trailing-debounced.
  let lagged = $state("");
  let laggedForId: string | null = null;
  let lagTimer: ReturnType<typeof setTimeout> | undefined;
  // Fix C: bumps once the deferred highlight.js chunk resolves (after this
  // component's first render if the load won the race vs. the first paint),
  // forcing the memoized render to re-run over the now-available highlighter.
  let highlightTick = $state(0);

  $effect(() => {
    void loadHighlighter().then(() => {
      highlightTick++;
    });
  });

  function cancelLagTimer(): void {
    if (lagTimer) {
      clearTimeout(lagTimer);
      lagTimer = undefined;
    }
  }

  const unsubscribeDoc = doc.subscribe((d) => {
    const id = d?.id ?? null;
    const next = d?.content ?? "";
    if (!debounceMs || id !== laggedForId) {
      // instant: reading mode, or a document switch (including this
      // component's fresh mount — laggedForId starts at null)
      cancelLagTimer();
      laggedForId = id;
      lagged = next;
      return;
    }
    if (next === lagged) return; // store churn without a content change
    cancelLagTimer();
    lagTimer = setTimeout(() => {
      lagTimer = undefined;
      lagged = next;
    }, debounceMs);
  });

  // Memoized render: one full parse+highlight per distinct content string,
  // keyed cache last-content → last-result.
  let memoKey: string | null = null;
  let memoRendered: { ok: true; html: string } | { ok: false; error: string } = {
    ok: true as const,
    html: "",
  };
  const rendered = $derived.by(() => {
    // Fix C: highlight.js loads off the first-paint path; when it arrives
    // (or fails), re-run the memoized render so code fences update — the
    // markdown pipeline invalidates its own cache on the same epoch bump.
    void highlightTick;
    if (lagged !== memoKey) {
      memoKey = lagged;
      try {
        memoRendered = { ok: true as const, html: renderMarkdown(lagged) };
      } catch (e) {
        memoRendered = { ok: false as const, error: String(e) };
      }
    }
    return memoRendered;
  });
  const isEmpty = $derived(lagged.trim() === "");

  let pane: HTMLDivElement | undefined;
  let column: HTMLDivElement | undefined;

  function totalLines(): number {
    return ($doc?.content.split(/\r\n|\r|\n/).length ?? 0);
  }

  // ---- block metadata: once per rendered version ----------------------------
  // Ordered blocks with their source ranges. The ranges come from the parse
  // result (sourceLineRanges() in markdown.ts, cached with the memoized
  // render); the key is the html currently in the pane (domKey, stamped
  // after each render), so a rebuild always matches the live DOM. The legacy
  // DOM-ancestry derivation only exists as a defensive fallback and runs at
  // most once per rendered version — never in the scroll handler.
  interface CachedBlock {
    el: HTMLElement;
    start: number;
    end: number;
  }
  let domKey = "";
  let blockCache: { key: string; blocks: CachedBlock[] } | null = null;

  function blockRanges(): CachedBlock[] {
    if (!pane) return [];
    const cache = blockCache;
    if (
      cache &&
      cache.key === domKey &&
      (cache.blocks.length === 0 || cache.blocks[0].el.isConnected)
    ) {
      return cache.blocks;
    }
    const els = Array.from(
      pane.querySelectorAll<HTMLElement>(".reading-column [data-source-line]"),
    );
    // ranges come from the parse result (cached with the memoized render,
    // index-aligned with DOM order); if alignment ever drifts, fall back to
    // the legacy DOM-ancestry derivation — only ever on this rebuild path,
    // once per rendered version, never per scroll frame
    const ranges = sourceLineRanges(lagged);
    const total = totalLines();
    let blocks: CachedBlock[];
    if (ranges.length === els.length) {
      // fast path: zip the cached parse-derived ranges with the DOM blocks
      blocks = els.map((el, i) => ({ el, start: ranges[i].start, end: ranges[i].end }));
    } else {
      blocks = els.map((el) => ({
        el,
        start: Number(el.dataset.sourceLine ?? "0"),
        end: Number.NaN,
      }));
      for (let i = 0; i < blocks.length; i++) {
        let end = total;
        for (let j = i + 1; j < blocks.length; j++) {
          if (!blocks[i].el.contains(blocks[j].el)) {
            end = blocks[j].start - 1;
            break;
          }
        }
        blocks[i].end = Math.max(blocks[i].start, end);
      }
    }
    blockCache = { key: domKey, blocks };
    return blocks;
  }

  // html whose DOM version the block cache is valid for; effects run in
  // definition order, so this stamps before the restore/capture effects
  // below in the same flush.
  $effect(() => {
    domKey = rendered.ok ? rendered.html : "";
  });

  /// Finds the last block whose top edge is at or above `anchorY` with a
  /// monotone binary search over live rects. Block tops are strictly
  /// ordered, so this is O(log n) getBoundingClientRect calls per call —
  /// no per-element scan, no `contains()` ancestry work.
  function blockIndexAtY(blocks: CachedBlock[], anchorY: number): number {
    const paneTop = pane!.getBoundingClientRect().top;
    let lo = 0;
    let hi = blocks.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const top = blocks[mid].el.getBoundingClientRect().top - paneTop + pane!.scrollTop;
      if (top <= anchorY) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found < 0 ? 0 : found;
  }

  function captureLive(): PositionAnchor | null {
    if (!pane || !pane.isConnected) return null;
    const maxScroll = pane.scrollHeight - pane.clientHeight;
    const anchorY = pane.scrollTop + pane.clientHeight * VIEWPORT_ANCHOR_FRACTION;
    const blocks = blockRanges();
    if (blocks.length === 0) return anchorFromBlocks([], anchorY, maxScroll, pane.scrollTop);
    // measure only the block under the anchor, then reuse the pure, tested
    // mapping helpers for the exact semantics
    const idx = blockIndexAtY(blocks, anchorY);
    const b = blocks[idx];
    const paneTop = pane.getBoundingClientRect().top;
    const top = b.el.getBoundingClientRect().top - paneTop + pane.scrollTop;
    const height = b.el.getBoundingClientRect().height;
    return anchorFromBlocks([{ start: b.start, end: b.end, top, height }], anchorY, maxScroll, pane.scrollTop);
  }

  function applyAnchor(anchor: PositionAnchor | null): void {
    if (!anchor || !pane) return;
    const maxScroll = pane.scrollHeight - pane.clientHeight;
    if (anchor.line < 1) {
      // fraction-only fallback (same as scrollFromAnchor's)
      pane.scrollTop = Math.min(1, Math.max(0, anchor.frac)) * Math.max(maxScroll, 0);
      return;
    }
    const blocks = blockRanges();
    if (blocks.length === 0) {
      pane.scrollTop = Math.min(1, Math.max(0, anchor.frac)) * Math.max(maxScroll, 0);
      return;
    }
    // locate the block whose source range contains (or edges) the line —
    // binary search over the cached ordered ranges, no DOM work
    let lo = 0;
    let hi = blocks.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (blocks[mid].start <= anchor.line) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const b = blocks[idx < 0 ? 0 : idx];
    // measure only that block
    const rect = pane.getBoundingClientRect();
    const top = b.el.getBoundingClientRect().top - rect.top + pane.scrollTop;
    const height = b.el.getBoundingClientRect().height;
    const targetY = pane.clientHeight * VIEWPORT_ANCHOR_FRACTION;
    pane.scrollTop = scrollFromAnchor(
      [{ start: b.start, end: b.end, top, height }],
      anchor,
      targetY,
      maxScroll,
    );
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
      // Fix D: a hidden pane reports no live geometry — never capture from it
      if (!visible) return;
      const key = $doc?.id;
      const anchor = captureLive();
      if (key && anchor) rememberPosition(key, anchor);
    });
  }

  // Named-block preservation across live re-renders (split view typing):
  // the pre-effect captures the block at the viewport anchor (from the DOM
  // about to be replaced), the post-effect re-scrolls so the same source
  // line lands back at that anchor.
  let preserved: PositionAnchor | null = null;
  let restored = false;
  let lastKey: string | null = null;
  // Fix D: the mode this pane last mounted/re-adopted under (a visible mode
  // change must re-adopt the shared anchor, as the old remount did)
  let modeAfterRemount: string | null = null;

  // watch document switches: when the document changes the pane should restore
  // that document's remembered anchor instead of preserving the old DOM's
  $effect(() => {
    const key = $doc?.id ?? null;
    if (key !== lastKey) {
      lastKey = key;
      restored = false;
      preserved = null;
    }
  });

  $effect.pre(() => {
    rendered;
    // Fix D: hidden panes have no live geometry — never capture from one
    if (!pane || !$doc || !restored || !visible) return;
    preserved = captureLive();
  });

  $effect(() => {
    rendered;
    // Fix D: `visible` is a dependency — the un-hide transition re-runs this
    // effect and re-adopts the anchor with real geometry, replacing the
    // old remount. `$mode` covers the reading ↔ split toggles where the pane
    // never leaves the DOM but the old code still remounted and re-adopted.
    const shown = visible;
    const currentMode = $mode;
    if (!pane || !$doc) return;
    if (!shown) {
      // hidden pane: adopt on the next show, exactly as a fresh mount did
      restored = false;
      preserved = null;
      return;
    }
    if (modeAfterRemount !== null && modeAfterRemount !== currentMode) {
      // pane stayed visible across a mode change; the old remount re-adopted
      restored = false;
      preserved = null;
    }
    modeAfterRemount = currentMode;
    if (!restored) {
      restored = true;
      applyAnchor(takePosition($doc.id));
      // make the map reflect the restored position immediately
      const anchor = captureLive();
      if (anchor) rememberPosition($doc.id, anchor);
      return;
    }
    if (preserved) {
      applyAnchor(preserved);
      preserved = null;
      const anchor = captureLive();
      if (anchor) rememberPosition($doc.id, anchor);
    }
  });

  // teardown: drop the doc subscription, any pending split-view lag timer
  // and the image observer (each Reader instance gets a fresh one; entries
  // observed by a stale observer are detached DOM anyway)
  $effect(() => () => {
    unsubscribeDoc();
    cancelLagTimer();
    imageObserver?.disconnect();
    imageObserver = null;
  });

  // continuous capture: scroll + fresh-mount registration
  $effect(() => {
    const el = pane;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    const key = $doc?.id;
    // Fix D: a hidden pane has no live geometry — skip the registration
    // capture until it is shown (the restore effect re-adopts then)
    if (key && visible) {
      const anchor = captureLive();
      if (anchor) rememberPosition(key, anchor);
    }
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
    const path = $doc?.path;
    if (!path) return null;
    const dir = await dirname(path);
    if (!dir) return null;
    const rel = decode(src);
    if (/^[a-zA-Z]:[\\/]/.test(rel)) return rel;
    try {
      return await resolve(dir, rel);
    } catch {
      return null;
    }
  }

  // ---- local images: lazy + cached (Fix B) ----------------------------------
  // Opening a document used to eagerly read EVERY local image over IPC
  // (sequentially, base64-inflated) at load time, and re-did the whole walk
  // on every re-render because data-local-src was never cleared. Now:
  //   - an <img data-local-src> carries no src until it nears the viewport
  //     (IntersectionObserver, 600px margin) — below-the-fold images only
  //     load when scrolled into view;
  //   - the resolved source comes from the shared LRU cache in
  //     local-images.ts (abs path → data URL, 50 entries) when possible, so
  //     repeated renders and document/mode switches cost no IPC;
  //   - once an image resolves, data-local-src is REMOVED, so later
  //     re-renders skip it entirely (the querySelectorAll never sees it).
  // The absolutePath() helper (dirname/resolve) is pure-JS in the Tauri API,
  // so the resolve loop here adds no per-image IPC.

  let imageObserver: IntersectionObserver | null = null;

  function observerFor(): IntersectionObserver {
    imageObserver ??= new IntersectionObserver(onImageNearViewport, {
      // start loading slightly before the image could be seen
      rootMargin: "600px 0px",
    });
    return imageObserver;
  }

  function onImageNearViewport(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      imageObserver?.unobserve(entry.target);
      const img = entry.target as HTMLImageElement;
      void resolveImage(img);
    }
  }

  function markUnreadable(img: HTMLImageElement): void {
    const note = document.createElement("span");
    note.className = "broken-image";
    note.textContent = img.alt ? `[unreadable image: ${img.alt}]` : "[unreadable image]";
    img.replaceWith(note);
  }

  /** Wire up every not-yet-loaded local image this render produced. */
  async function loadLocalImages(root: HTMLElement): Promise<void> {
    const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-local-src]"));
    if (images.length === 0) return;
    const obs = observerFor();
    for (const img of images) {
      const src = img.dataset.localSrc ?? "";
      const abs = await absolutePath(src);
      // a re-render (or a load that already landed) may have replaced /
      // resolved this element while the path resolved
      if (!img.isConnected || img.dataset.localSrc === undefined) continue;
      if (!abs) {
        markUnreadable(img);
        continue;
      }
      const hit = cachedImage(abs);
      if (hit !== undefined) {
        applyLoadedImage(img, hit);
        continue;
      }
      obs.observe(img);
    }
  }

  /** IO callback path: the image is near the viewport — load and show it. */
  async function resolveImage(img: HTMLImageElement): Promise<void> {
    const src = img.dataset.localSrc;
    if (src === undefined) return; // already resolved (cache-hit on re-render)
    const abs = await absolutePath(src);
    if (!img.isConnected || img.dataset.localSrc === undefined) return;
    if (!abs) {
      markUnreadable(img);
      return;
    }
    let url: string | null = null;
    try {
      url = await loadImageFromDisk(abs, readImageData);
    } catch {
      url = null;
    }
    if (!img.isConnected || img.dataset.localSrc === undefined) return;
    if (!url) {
      markUnreadable(img);
      return;
    }
    applyLoadedImage(img, url);
  }

  function applyLoadedImage(img: HTMLImageElement, url: string): void {
    img.src = url;
    img.decoding = "async";
    // the whole point of Fix B: later re-renders never re-read this image
    delete img.dataset.localSrc;
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
    /* measure: ~70ch keeps single-column prose at a comfortable line length
       while tables/code still scroll or max out via their own rules */
    max-width: 70ch;
    margin: 0 auto;
    min-height: calc(100% - 96px);
    font-size: 16.5px;
    /* Reader prose carries the serif (--font-prose): paragraphs, lists,
       blockquotes and headings inherit it; code styles below explicitly
       re-apply JetBrains Mono. Line-height rides slightly higher than the
       sans baseline so a book-weight serif doesn't feel cramped. */
    font-family: var(--font-prose);
    line-height: 1.8;
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
    letter-spacing: -0.018em;
    text-wrap: balance;
    margin: 0 0 28px;
  }

  .reading-column :global(h2) {
    font-size: 26px;
    letter-spacing: -0.012em;
    text-wrap: balance;
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
    padding: 2px 0 2px 16px;
    border-left: 2px solid var(--border-strong);
    color: var(--muted-foreground);
    font-size: 0.96em;
    letter-spacing: 0.002em;
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
    border-radius: var(--radius-sm);
  }

  /* ---- code blocks ---- */

  .reading-column :global(.code-block) {
    position: relative;
    margin: 0 0 24px;
    background: var(--code-background);
    border-radius: var(--radius-xl);
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
    border-radius: var(--radius-sm);
    font-size: 11.5px;
    color: var(--muted-foreground);
    background: var(--surface-raised);
    opacity: 0;
    transition: opacity 0.13s ease;
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
    display: inline-block;
    border-radius: var(--radius-xl);
  }

  /* Fix B: pending lazy image (no src yet) — an intentional quiet placeholder
     instead of a zero-size invisible element, and less layout shift when it
     resolves; the hairline dashed frame reads as "loading", not broken */
  .reading-column :global(img[data-local-src]) {
    min-height: 44px;
    min-width: 64px;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius-xl);
    transition: opacity var(--transition-fast);
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
    border: 1px dashed var(--border);
    border-radius: var(--radius-xl);
    font-size: 13px;
    font-style: italic;
    color: var(--muted-foreground);
    text-align: center;
    cursor: pointer;
  }

  .reading-column :global(.remote-image:hover) {
    border-color: var(--accent);
    color: var(--foreground);
  }
</style>
