<script lang="ts">
  import { get } from "svelte/store";
  import { mode, sidebarOpen, theme, doc, saveState, overlay } from "../stores";
  import {
    requestNewDocument,
    saveDocument,
    saveDocumentAs,
    closeDocument,
    revealDocument,
  } from "../actions";

  let menuOpen = $state(false);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Reading/Split availability comes from the format registry, so a format
  // without a reader (or without split support) disables them cleanly.
  const canRead = $derived($doc?.format.reader === "markdown");
  const canSplit = $derived($doc?.format.splitSupported === true);
  const formatLabel = $derived($doc?.format.label ?? "This file");

  // any overlay opening (palette, file switcher, outline) dismisses the menu
  $effect(() => {
    $overlay;
    menuOpen = false;
  });

  function setMode(next: "reading" | "edit" | "split") {
    mode.set(next);
  }

  async function copyMarkdown() {
    const current = get(doc);
    if (!current) return;
    await navigator.clipboard.writeText(current.content);
    toast = "Copied";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 1500);
  }
</script>

<header class="toolbar">
  <div class="left">
    <button
      class="icon-btn"
      type="button"
      title="Toggle sidebar"
      onclick={() => sidebarOpen.set(!$sidebarOpen)}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
        ><path d="M2 3.5h12M2 8h12M2 12.5h12"/></svg
      >
    </button>
    <span class="filename">{ $doc ? $doc.filename : "" }</span>
  </div>

  <div class="right">
    <div class="save-state">
      {#if $doc}
        {#if $saveState === "saving"}Saving...{:else if $saveState === "unsaved"}Unsaved{:else}Saved{/if}
      {/if}
    </div>

    <div class="mode-switch" role="group" aria-label="View mode">
      <button
        type="button"
        class:active={$mode === "reading"}
        disabled={!canRead}
        title={canRead ? undefined : `${formatLabel} has no reading view`}
        onclick={() => setMode("reading")}
      >Reading</button>
      <button
        type="button"
        class:active={$mode === "edit"}
        onclick={() => setMode("edit")}
      >Edit</button>
      <button
        type="button"
        class:active={$mode === "split"}
        disabled={!canSplit}
        title={canSplit ? "Split view" : `${formatLabel} has no split view`}
        onclick={() => setMode("split")}
      >Split</button>
    </div>

    <button
      class="icon-btn"
      type="button"
      title="More actions"
      onclick={() => (menuOpen = !menuOpen)}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"
        ><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg
      >
    </button>

  {#if menuOpen}
    <button
      class="menu-backdrop"
      type="button"
      aria-label="Close menu"
      onclick={() => (menuOpen = false)}
    ></button>
      <div class="menu" role="menu">
        <div class="menu-label">File</div>
        <button type="button" role="menuitem" onclick={() => { void requestNewDocument(); menuOpen = false; }}>New</button>
        {#if $doc}
          {#if $doc.format.id === "markdown"}
            <button type="button" role="menuitem" onclick={() => { copyMarkdown(); menuOpen = false; }}>Copy Markdown</button>
          {/if}
          <button type="button" role="menuitem" onclick={() => { void saveDocument(); menuOpen = false; }}>Save</button>
          <button type="button" role="menuitem" onclick={() => { saveDocumentAs(); menuOpen = false; }}>Save As...</button>
          {#if $doc.path}
            <button type="button" role="menuitem" onclick={() => { revealDocument(); menuOpen = false; }}>Reveal in Explorer</button>
          {/if}
          <button type="button" role="menuitem" onclick={() => { closeDocument(); menuOpen = false; }}>Close</button>
        {/if}
        <div class="menu-label">Theme</div>
        <button
          type="button"
          role="menuitem"
          class:selected={$theme === "dark"}
          onclick={() => { theme.set("dark"); menuOpen = false; }}
        >Dark</button>
        <button
          type="button"
          role="menuitem"
          class:selected={$theme === "light"}
          onclick={() => { theme.set("light"); menuOpen = false; }}
        >Light</button>
        <button
          type="button"
          role="menuitem"
          class:selected={$theme === "system"}
          onclick={() => { theme.set("system"); menuOpen = false; }}
        >System</button>
      </div>
    {/if}

    {#if toast}
      <div class="toast" role="status">{toast}</div>
    {/if}
  </div>
</header>

<style>
  .toolbar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    padding: 0 12px;
    border-bottom: 1px solid var(--hairline);
    background: var(--background);
    flex-shrink: 0;
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .filename {
    font-size: 13px;
    color: var(--foreground);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 420px;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--muted-foreground);
  }

  .icon-btn:hover {
    background: var(--surface-raised);
    color: var(--foreground);
  }

  .save-state {
    min-width: 0;
    font-size: 11px;
    color: var(--muted-foreground);
  }

  .mode-switch {
    display: flex;
    padding: 2px;
    border-radius: 7px;
    background: var(--surface);
    border: 1px solid var(--hairline);
  }

  .mode-switch button {
    padding: 3px 12px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--muted-foreground);
  }

  .mode-switch button.active {
    background: var(--surface-raised);
    color: var(--foreground);
    font-weight: 500;
  }

  .mode-switch button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .menu {
    position: absolute;
    top: 38px;
    right: 8px;
    z-index: 50;
    min-width: 180px;
    padding: 6px;
    background: var(--popover);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    animation: menu-in 0.1s ease;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }

  .menu-label {
    padding: 4px 10px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .menu button {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border-radius: 5px;
    font-size: 13px;
    text-align: left;
    color: var(--foreground);
  }

  .menu button:hover {
    background: var(--surface-raised);
  }

  .menu button.selected::after {
    content: "✓";
    float: right;
    color: var(--accent);
  }

  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    padding: 7px 14px;
    border-radius: 7px;
    background: var(--popover);
    border: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--foreground);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    animation: toast-in 0.12s ease;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
