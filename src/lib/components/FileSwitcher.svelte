<script lang="ts">
  // Phase 5: quick file switcher (Ctrl+P). Searches the recent-files list —
  // the same source of truth the sidebar shows. Opening goes through
  // openPath, so flush-save, discard confirm, and recent-file ordering all
  // behave exactly as they do when a file is opened any other way.

  import Overlay from "./Overlay.svelte";
  import { fuzzySort } from "../fuzzy";
  import { overlay, recentFiles } from "../stores";
  import { openPath } from "../actions";

  interface RecentFile {
    path: string;
    name: string;
    dir: string;
  }

  function fileParts(path: string): RecentFile {
    const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    return {
      path,
      name: i === -1 ? path : path.slice(i + 1),
      dir: i === -1 ? "" : path.slice(0, i),
    };
  }

  const files = $derived($recentFiles.map(fileParts));

  let query = $state("");
  let selected = $state(0);
  let inputEl: HTMLInputElement | undefined;
  let listEl: HTMLDivElement | undefined;

  $effect(() => {
    inputEl?.focus();
  });

  const items = $derived(fuzzySort(query, files, (f) => `${f.name} ${f.dir}`));

  $effect(() => {
    query;
    selected = 0;
  });

  $effect(() => {
    items;
    selected = Math.min(selected, Math.max(items.length - 1, 0));
    const el = listEl?.querySelector<HTMLElement>(".item.selected");
    el?.scrollIntoView({ block: "nearest" });
  });

  function open(file: RecentFile): void {
    overlay.set(null);
    void openPath(file.path);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, items.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const file = items[selected];
      if (file) open(file);
    }
    // Esc is handled by the global keydown handler (closes the overlay)
  }
</script>

<Overlay>
  <div class="switcher">
    <input
      type="text"
      bind:value={query}
      bind:this={inputEl}
      placeholder="Type to search recent files…"
      onkeydown={onKeydown}
    />
    <div class="list" bind:this={listEl}>
      {#each items as file, i (file.path)}
        <button
          type="button"
          class="item"
          class:selected={selected === i}
          onmousemove={() => (selected = i)}
          onclick={() => open(file)}
        >
          <span class="name">{file.name}</span>
          {#if file.dir}
            <span class="path">{file.dir}</span>
          {/if}
        </button>
      {/each}
      {#if items.length === 0}
        <div class="empty">
          {#if $recentFiles.length === 0}No recent files yet{/if}
          {#if $recentFiles.length > 0 && query}No matching files{/if}
        </div>
      {/if}
    </div>
  </div>
</Overlay>

<style>
  .switcher input {
    display: block;
    width: 100%;
    padding: 13px 16px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--hairline);
    font: inherit;
    font-size: 13.5px;
    color: var(--foreground);
    outline: none;
  }

  .switcher input::placeholder {
    color: var(--muted-foreground);
  }

  .list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
  }

  .item {
    display: block;
    width: 100%;
    padding: 7px 12px;
    border-radius: 6px;
    text-align: left;
    color: var(--foreground);
  }

  .item.selected {
    background: var(--surface-raised);
  }

  .name {
    display: block;
    font-size: 13px;
  }

  .item.selected .name {
    color: var(--accent);
  }

  .path {
    display: block;
    margin-top: 1px;
    font-size: 11.5px;
    color: var(--muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 24px 12px;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted-foreground);
  }
</style>
