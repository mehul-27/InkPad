<script lang="ts">
  // Phase 6: Split View (Ctrl+Shift+E). The same Editor and Reader panes the
  // single modes use, side by side — both read and write the one
  // authoritative `doc` store, so autosave and rendering behave exactly as
  // they do in the other modes. Markdown only; plain text never mounts this
  // view (DocumentPane guards it per spec §23).

  import Editor from "./Editor.svelte";
  import Reader from "./Reader.svelte";

  // editor pane width in percent; the Reader takes the rest
  let split = $state(55);
  let dragging = $state(false);
  let root: HTMLDivElement | undefined;

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
</script>

<div class="split" class:dragging bind:this={root}>
  <div class="pane editor-pane" style="flex-basis: {split}%">
    <Editor />
  </div>
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
  <div class="pane reader-pane">
    <Reader />
  </div>
</div>

<style>
  .split {
    display: flex;
    height: 100%;
    min-width: 0;
    background: var(--background);
  }

  .pane {
    min-width: 0;
    overflow: hidden;
  }

  .editor-pane {
    flex: 0 0 auto;
    min-width: 240px;
  }

  .reader-pane {
    flex: 1 1 0;
    min-width: 280px;
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