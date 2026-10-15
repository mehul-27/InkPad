<script lang="ts">
  import { mode, doc } from "../stores";
  import Reader from "./Reader.svelte";
  import Editor from "./Editor.svelte";
  import { readerSupported } from "../docs";

  // Perf (Fix D): one persistent Editor pane and one persistent Reader pane
  // survive every Reading ↔ Edit ↔ Split toggle. `mode` only switches pane
  // visibility (display:none) — the CodeMirror view, its scroll position and
  // its undo history are never torn down for a mode change. Previously every
  // toggle unmounted and remounted the whole component tree, forcing a fresh
  // EditorState (full document parse) and a fresh pane render.
  //
  // Markdown is the only format with two useful representations (rendered and
  // source), so Reading and Split exist only where the registry says a reader
  // does. Every other format has exactly one surface: the editor. The
  // capabilities come from the format registry — there is no Markdown list
  // here. (Split layout was formerly in its own SplitView.svelte; the divider
  // logic moved here so the panes can outlive mode switches.)
  const canRead = $derived($doc != null && readerSupported($doc.format));
  const canSplit = $derived($doc != null && $doc.format.splitSupported);
  const splitMode = $derived(canSplit && $mode === "split");
  const readingMode = $derived(canRead && $mode === "reading");
  const editorShown = $derived($doc != null && !readingMode);
  const readerShown = $derived($doc != null && (readingMode || splitMode));

  // editor pane width in split mode, in percent; the Reader takes the rest.
  // Reset to the default whenever split mode is entered, exactly as the old
  // remounted SplitView component did.
  const DEFAULT_SPLIT = 55;
  let split = $state(DEFAULT_SPLIT);
  let dragging = $state(false);
  let root: HTMLDivElement | undefined;

  $effect(() => {
    if (splitMode) {
      split = DEFAULT_SPLIT;
      dragging = false;
    }
  });

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || !root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width === 0) return;
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    split = Math.min(78, Math.max(22, percent));
  }

  function onPointerUp(): void {
    dragging = false;
  }

  const editorBasis = $derived(splitMode ? `${split}%` : "100%");
  const readerBasis = $derived(splitMode ? `${100 - split}%` : "100%");
</script>

<div class="split" class:dragging bind:this={root}>
  <div
    class="pane editor-pane"
    class:hidden={!editorShown}
    style="flex-basis: {editorBasis}"
  >
    <Editor visible={editorShown} />
  </div>
  {#if splitMode}
    <div
      class="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split panes"
      aria-valuenow={Math.round(split)}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    ></div>
  {/if}
  {#if canRead}
    <div
      class="pane reader-pane"
      class:hidden={!readerShown}
      style="flex-basis: {readerBasis}"
    >
      <!-- perf Fix A: typing in split view lags the rendered pane by ≤150ms -->
      <Reader visible={readerShown} debounceMs={splitMode ? 150 : 0} />
    </div>
  {/if}
</div>

<style>
  .split {
    position: relative;
    display: flex;
    height: 100%;
    min-width: 0;
    background: var(--background);
  }

  .pane {
    min-width: 0;
    overflow: hidden;
    height: 100%;
  }

  /* Mode switch (Reading ↔ Edit ↔ Split): the pane that flips back to
     visible fades/lifts in. Opacity + transform only — compositor work that
     cannot affect layout, sizing or scroll offsets, so the persistent
     views' anchor-restore (verify-position) stays byte-for-byte. An
     entrance animation re-runs each time the .hidden class is removed. */
  .pane:not(.hidden) {
    animation: pane-show 140ms ease-out;
  }

  @keyframes pane-show {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
  }

  /* Fix D: a hidden pane is parked in an absolute overlay with
     `visibility: hidden` instead of `display: none`. display:none collapses
     the layout, breaks CodeMirror's IntersectionObserver-driven flushes (its
     viewport then never re-renders at the restored scroll offset) and makes
     scroll restore asynchronous and fragile. A visibility-hidden overlay
     keeps real geometry: the persistent view keeps measuring, scroll
     restores apply against live layout, and the next show is instant.
     pointer-events + user-select guard the pane beneath it. */
  .pane.hidden {
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
    user-select: none;
  }

  /* subtle but clearly draggable: generous hit target, thin visible line */
  .divider {
    flex: 0 0 9px;
    display: flex;
    justify-content: center;
    cursor: col-resize;
    background: var(--background);
  }

  .divider::after {
    content: "";
    width: 1px;
    background: var(--hairline);
    transition: background-color 0.12s ease, width 0.12s ease;
  }

  .divider:hover::after,
  .split.dragging .divider::after {
    width: 3px;
    background: var(--border-strong);
    border-radius: 2px;
  }

  .split.dragging {
    user-select: none;
  }
</style>
