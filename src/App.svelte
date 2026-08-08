<script lang="ts">
  import { onMount } from "svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import EmptyState from "./lib/components/EmptyState.svelte";
  import DocumentPane from "./lib/components/DocumentPane.svelte";
  import { doc, dropActive } from "./lib/stores";
  import { isSupportedFile } from "./lib/docs";
  import { getStartupFile, onOpenFileRequest, onDragDrop } from "./lib/api";
  import { openPath, refreshRecents } from "./lib/actions";

  onMount(() => {
    const cleanups: Array<() => void> = [];

    refreshRecents();

    // "Open with InkPad": first launch gets the path via argv, later
    // launches arrive as an open-file event from the single-instance plugin.
    getStartupFile().then((path) => {
      if (path) openPath(path);
    });
    onOpenFileRequest((path) => openPath(path)).then((un) => cleanups.push(un));
    onDragDrop((paths, active) => {
      if (active) {
        dropActive.set(paths.some(isSupportedFile));
      } else {
        dropActive.set(false);
        const path = paths.find(isSupportedFile);
        if (path) openPath(path);
      }
    }).then((un) => cleanups.push(un));

    return () => cleanups.forEach((un) => un());
  });
</script>

<div class="app">
  <Sidebar />

  <div class="main">
    <Toolbar />
    {#if $doc}
      <DocumentPane />
    {:else}
      <EmptyState />
    {/if}
  </div>

  {#if $dropActive}
    <div class="drop-overlay"><span>Drop file to open</span></div>
  {/if}
</div>

<style>
  .app {
    position: relative;
    display: flex;
    height: 100%;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    border: 1px dashed var(--accent);
    font-size: 13px;
    color: var(--foreground);
    pointer-events: none;
  }
</style>
