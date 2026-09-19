<script lang="ts">
  // Phase 5: command palette (Ctrl+K). Lists only functionality that is
  // implemented; doc-dependent commands disappear when no document is open.

  import { get } from "svelte/store";
  import Overlay from "./Overlay.svelte";
  import { fuzzySort } from "../fuzzy";
  import { doc, mode, overlay, sidebarOpen, theme } from "../stores";
  import { isMarkdown } from "../docs";
  import {
    requestNewDocument,
    openDocument,
    saveDocument,
    saveDocumentAs,
    closeDocument,
    revealDocument,
    toggleMode,
    toggleSplit,
    toggleDistractionFree,
    requestSearch,
    requestReplace,
  } from "../actions";

  interface Command {
    title: string;
    shortcut?: string;
    requiresDoc?: boolean;
    requiresPath?: boolean;
    requiresMarkdown?: boolean;
    run: () => void;
  }

  const commands = $derived.by((): Command[] => {
    const list: Command[] = [
      { title: "New Document", shortcut: "Ctrl+N", run: () => void requestNewDocument() },
      { title: "Open File...", shortcut: "Ctrl+O", run: () => void openDocument() },
      { title: "Save", shortcut: "Ctrl+S", requiresDoc: true, run: () => void saveDocument() },
      { title: "Save As...", shortcut: "Ctrl+Shift+S", requiresDoc: true, run: () => void saveDocumentAs() },
      { title: "Close Document", requiresDoc: true, run: () => void closeDocument() },
      { title: "Reveal in Explorer", requiresDoc: true, requiresPath: true, run: revealDocument },
      {
        title: "Copy Markdown",
        requiresDoc: true,
        requiresMarkdown: true,
        run: () => navigator.clipboard.writeText($doc?.content ?? ""),
      },
      { title: "Toggle Reading / Edit", shortcut: "Ctrl+E", requiresDoc: true, requiresMarkdown: true, run: toggleMode },
      {
        title: "Toggle Split View",
        shortcut: "Ctrl+Shift+E",
        requiresDoc: true,
        requiresMarkdown: true,
        run: toggleSplit,
      },
      { title: "Toggle Distraction-Free", shortcut: "Ctrl+Shift+F", run: toggleDistractionFree },
      {
        title: "Toggle Sidebar",
        shortcut: "Ctrl+B",
        run: () => sidebarOpen.set(!get(sidebarOpen)),
      },
      { title: "Search", shortcut: "Ctrl+F", requiresDoc: true, run: requestSearch },
      { title: "Replace", shortcut: "Ctrl+H", requiresDoc: true, run: requestReplace },
      { title: "Document Outline", shortcut: "Ctrl+Shift+O", requiresDoc: true, run: () => overlay.set("outline") },
      { title: "Settings", run: () => overlay.set("settings") },
      { title: "Theme: Dark", run: () => theme.set("dark") },
      { title: "Theme: Light", run: () => theme.set("light") },
      { title: "Theme: System", run: () => theme.set("system") },
    ];
    return list.filter(
      (c) => !c.requiresDoc || $doc != null,
    ).filter(
      (c) => !c.requiresPath || $doc?.path != null,
    ).filter(
      // Markdown-only commands (Reading/Edit, Split, Copy Markdown) are
      // hidden for formats that have a single editor surface
      (c) => !c.requiresMarkdown || ($doc != null && isMarkdown($doc.format)),
    );
  });

  let query = $state("");
  let selected = $state(0);
  let inputEl: HTMLInputElement | undefined;
  let listEl: HTMLDivElement | undefined;

  $effect(() => {
    inputEl?.focus();
  });

  const items = $derived(fuzzySort(query, commands, (c) => c.title));

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

  function run(command: Command): void {
    overlay.set(null);
    command.run();
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
      const command = items[selected];
      if (command) run(command);
    }
    // Esc is handled by the global keydown handler (closes the overlay)
  }
</script>

<Overlay>
  <div class="palette">
    <input
      type="text"
      bind:value={query}
      bind:this={inputEl}
      placeholder="Type a command…"
      onkeydown={onKeydown}
    />
    <div class="list" bind:this={listEl}>
      {#each items as command, i (command.title)}
        <button
          type="button"
          class="item"
          class:selected={selected === i}
          onmousemove={() => (selected = i)}
          onclick={() => run(command)}
        >
          <span class="title">{command.title}</span>
          {#if command.shortcut}
            <span class="kbd">{command.shortcut}</span>
          {/if}
        </button>
      {/each}
      {#if items.length === 0}
        <div class="empty">No matching commands</div>
      {/if}
    </div>
  </div>
</Overlay>

<style>
  .palette input {
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

  .palette input::placeholder {
    color: var(--muted-foreground);
  }

  .list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
  }

  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 13px;
    text-align: left;
    color: var(--foreground);
  }

  .item.selected {
    background: var(--surface-raised);
  }

  .item.selected .title {
    color: var(--accent);
  }

  .kbd {
    flex-shrink: 0;
    font-size: 11.5px;
    color: var(--muted-foreground);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 6px;
  }

  .empty {
    padding: 24px 12px;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted-foreground);
  }
</style>
