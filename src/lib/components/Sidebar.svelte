<script lang="ts">
  import { sidebarOpen, recentFiles, doc, overlay } from "../stores";
  import { openDocument, openPath } from "../actions";
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
      >{path.split(/[\\/]/).pop()}</button>
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
</style>
