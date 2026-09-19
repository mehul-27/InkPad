<script lang="ts">
  import { sidebarOpen, recentFiles, doc, overlay } from "../stores";
  import { openDocument, openPath, removeRecentPath } from "../actions";
  import { filenameOf } from "../docs";

  // Right-click menu for a recent entry. Fixed positioning keeps it clear of
  // the sidebar's overflow clipping; it dismisses on any outside press,
  // Escape, scroll, resize, or when the sidebar is hidden.
  const MENU_WIDTH = 184;
  const MENU_HEIGHT = 38;

  let menu = $state<{ path: string; x: number; y: number } | null>(null);
  let menuEl = $state<HTMLDivElement | undefined>();

  function openMenu(event: MouseEvent, path: string): void {
    event.preventDefault();
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - 8));
    menu = { path, x, y };
  }

  function closeMenu(): void {
    menu = null;
  }

  function remove(path: string): void {
    closeMenu();
    void removeRecentPath(path);
  }

  $effect(() => {
    if (!menu) return;
    const inside = (target: EventTarget | null): boolean =>
      menuEl != null && target instanceof Node && menuEl.contains(target);
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) closeMenu();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onContextMenu = (e: MouseEvent) => {
      // right-clicking another entry reopens; anywhere else dismisses
      if (!inside(e.target)) closeMenu();
    };
    const onScroll = () => closeMenu();
    const onResize = () => closeMenu();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  });

  $effect(() => {
    if (!$sidebarOpen) closeMenu();
  });
</script>

<aside class="sidebar" class:hidden={!$sidebarOpen}>
  <div class="wordmark">
    <img class="wordmark-img" src="/inkpad-mark.png" alt="" width="18" height="18" />
    InkPad
  </div>

  <div class="section-label">Recent</div>
  <div class="recent-list">
    {#each $recentFiles as path}
      <button
        class="recent-item"
        class:active={$doc?.path === path}
        type="button"
        title={path}
        onclick={() => openPath(path)}
        oncontextmenu={(e) => openMenu(e, path)}
      >{filenameOf(path)}</button>
    {/each}
  </div>

  <div class="footer">
    <button class="footer-item" type="button" onclick={openDocument}>
      <span class="footer-icon" aria-hidden="true"
        ><svg viewBox="0 0 16 16" width="14" height="14" fill="none"
          stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg
        ></span>
      Open File
    </button>
    <button class="footer-item" type="button" onclick={() => overlay.set("settings")}>
      <span class="footer-icon" aria-hidden="true"
        ><svg viewBox="0 0 16 16" width="14" height="14" fill="none"
          stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.6"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1"/></svg
        ></span>
      Settings
    </button>
  </div>

  {#if menu}
    <div
      class="context-menu"
      role="menu"
      aria-label="Recent file actions"
      tabindex="-1"
      style="left: {menu.x}px; top: {menu.y}px"
      bind:this={menuEl}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onclick={() => {
          if (menu) remove(menu.path);
        }}
      >Remove from Recent</button>
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: 230px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--hairline);
    overflow-y: auto;
    transition: width 0.15s ease, opacity 0.15s ease;
  }

  .sidebar.hidden {
    width: 0;
    border-right: none;
    overflow: hidden;
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 18px 14px;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--foreground);
  }

  .wordmark-img {
    display: block;
    flex-shrink: 0;
  }

  .section-label {
    padding: 8px 18px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    padding: 0 10px;
  }

  .recent-item {
    position: relative;
    padding: 6px 8px 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--muted-foreground);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-item:hover {
    background: var(--surface-raised);
    color: var(--foreground);
  }

  .recent-item.active {
    background: var(--surface-raised);
    color: var(--foreground);
    font-weight: 500;
  }

  .recent-item.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 5px;
    bottom: 5px;
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .footer {
    margin-top: auto;
    padding: 10px 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-top: 1px solid var(--hairline);
  }

  .footer-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--muted-foreground);
    text-align: left;
  }

  .footer-item:hover {
    background: var(--surface-raised);
    color: var(--foreground);
  }

  .footer-icon {
    display: inline-flex;
    color: var(--muted-foreground);
  }

  /* ---- recent-file context menu ---- */

  .context-menu {
    position: fixed;
    z-index: 80;
    min-width: 184px;
    padding: 4px;
    background: var(--popover);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    animation: menu-in 0.1s ease;
  }

  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border-radius: 5px;
    font-size: 13px;
    text-align: left;
    color: var(--foreground);
  }

  .context-menu button:hover {
    background: var(--surface-raised);
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }
</style>
