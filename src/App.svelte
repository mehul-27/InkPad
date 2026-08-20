<script lang="ts">
  import { onMount } from "svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import EmptyState from "./lib/components/EmptyState.svelte";
  import DocumentPane from "./lib/components/DocumentPane.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import FileSwitcher from "./lib/components/FileSwitcher.svelte";
  import OutlinePanel from "./lib/components/OutlinePanel.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import {
    doc,
    dropActive,
    recentFiles,
    overlay,
    sidebarOpen,
    distractionFree,
  } from "./lib/stores";
  import { get } from "svelte/store";
  import { isSupportedFile } from "./lib/docs";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getStartupFile, getWelcomeFile, onOpenFileRequest, onDragDrop } from "./lib/api";
  import {
    openPath,
    openWelcome,
    openDocument,
    refreshRecents,
    flushSave,
    saveDocumentAs,
    toggleMode,
    toggleSplit,
    toggleDistractionFree,
    requestSearch,
    requestReplace,
  } from "./lib/actions";
  import { settings } from "./lib/settings";

  // Launch priority (§ onboarding): a file passed on the command line
  // ("Open with InkPad") wins; otherwise the bundled welcome opens on the
  // first-ever launch; otherwise the most recent document is restored when
  // one exists; otherwise the empty state shows.
  async function startup(): Promise<void> {
    const startupPath = await getStartupFile();
    if (startupPath) {
      await openPath(startupPath);
      return;
    }
    const welcomePath = await getWelcomeFile();
    if (welcomePath) {
      await openWelcome(welcomePath);
      return;
    }
    const recents = get(recentFiles);
    if (recents.length > 0) {
      await openPath(recents[0]);
    }
  }

  onMount(() => {
    const cleanups: Array<() => void> = [];

    refreshRecents().then(() => void startup());
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

    // Application keyboard shortcuts (spec §"keyboard table", Phase 5).
    // The CodeMirror editor owns its own keys while focused (Mod-f, Mod-h,
    // Esc, ...); everything else lands here.
    const onKeydown = (e: KeyboardEvent) => {
      const inEditor = !!document.activeElement?.closest(".cm-editor");

      // Esc closes the active overlay (the editor handles its own Esc);
      // with no overlay open it exits distraction-free mode.
      if (e.key === "Escape") {
        if (get(overlay)) {
          e.preventDefault();
          overlay.set(null);
          return;
        }
        if (get(distractionFree)) {
          e.preventDefault();
          distractionFree.set(false);
          return;
        }
      }

      if (e.altKey || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();

      if (k === "k") {
        e.preventDefault();
        overlay.set("palette");
      } else if (k === "p") {
        e.preventDefault();
        overlay.set("files");
      } else if (k === "o" && e.shiftKey) {
        e.preventDefault();
        overlay.set("outline");
      } else if (k === "o") {
        e.preventDefault();
        void openDocument();
      } else if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) void saveDocumentAs();
        else void flushSave();
      } else if (k === "e" && e.shiftKey) {
        e.preventDefault();
        toggleSplit();
      } else if (k === "e") {
        e.preventDefault();
        toggleMode();
      } else if (k === "f" && e.shiftKey) {
        e.preventDefault();
        toggleDistractionFree();
      } else if (k === "b") {
        e.preventDefault();
        sidebarOpen.set(!get(sidebarOpen));
      } else if (k === "f" && !inEditor) {
        e.preventDefault();
        requestSearch();
      } else if (k === "h" && !inEditor) {
        e.preventDefault();
        requestReplace();
      }
    };
    window.addEventListener("keydown", onKeydown);
    cleanups.push(() => window.removeEventListener("keydown", onKeydown));

    // save on window deactivation and on close (§25). Autosave-off (Settings)
    // disables the blur save but keeps the close-save: closing never risks
    // losing work. The welcome document is exempt from blur-save: it only
    // persists via Save As, and the save dialog must not pop up when the
    // user merely alt-tabs away.
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && get(settings).autosave && !get(doc)?.welcome) void flushSave();
      })
      .then((un) => cleanups.push(un));
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!get(doc)?.dirty) return; // nothing pending, close normally
        event.preventDefault();
        await flushSave();
        if (!get(doc)?.dirty) {
          await getCurrentWindow().destroy();
        }
        // save failed: keep the window open so the error dialog is visible
      })
      .then((un) => cleanups.push(un));

    return () => cleanups.forEach((un) => un());
  });
</script>

<div class="app" class:df={$distractionFree}>
  <Sidebar />

  <div class="main">
    <Toolbar />
    <!-- distraction-free keeps the document at reading width, centered -->
    <div class="df-wrap">
      {#if $doc}
        <DocumentPane />
      {:else}
        <EmptyState />
      {/if}
    </div>
  </div>

  {#if $dropActive}
    <div class="drop-overlay"><span>Drop file to open</span></div>
  {/if}

  {#if $overlay === "palette"}
    <CommandPalette />
  {:else if $overlay === "files"}
    <FileSwitcher />
  {:else if $overlay === "outline"}
    <OutlinePanel />
  {:else if $overlay === "settings"}
    <Settings />
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

  .df-wrap {
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  /* distraction-free (Phase 6): hide chrome, keep the document centered at
     a comfortable reading width — it must not stretch full-width */
  .app.df :global(.sidebar),
  .app.df :global(.toolbar) {
    display: none;
  }

  .app.df .df-wrap {
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
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
