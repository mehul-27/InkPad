<script lang="ts">
  import { mode, sidebarOpen, theme } from "../stores";

  let menuOpen = $state(false);

  function setMode(next: "reading" | "edit") {
    mode.set(next);
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
    <!-- ponytail: filename shown once Phase 2 provides a document -->
    <span class="filename" class:has-doc={false}></span>
  </div>

  <div class="right">
    <div class="save-state"></div>

    <div class="mode-switch" role="group" aria-label="View mode">
      <button
        type="button"
        class:active={$mode === "reading"}
        onclick={() => setMode("reading")}
      >Reading</button>
      <button
        type="button"
        class:active={$mode === "edit"}
        onclick={() => setMode("edit")}
      >Edit</button>
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
      </div>
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
</style>
