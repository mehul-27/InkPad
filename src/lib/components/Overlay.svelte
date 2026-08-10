<script lang="ts">
  // Phase 5: shared overlay foundation for the command palette, quick file
  // switcher, and document outline. The panel is a sibling painted above the
  // backdrop, so clicks inside it never reach the backdrop. Clicking the
  // backdrop or pressing Esc (handled globally in App.svelte) closes the
  // active overlay.

  import { overlay } from "../stores";
  import type { Snippet } from "svelte";

  let { align = "center", width, children }: { align?: "center" | "right"; width?: number; children?: Snippet } = $props();

  function close(): void {
    overlay.set(null);
  }

  function closeOnKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      close();
    }
  }
</script>

<div class="layer">
  <div
    class="backdrop"
    class:right={align === "right"}
    role="button"
    aria-label="Close overlay"
    tabindex="0"
    onclick={close}
    onkeydown={closeOnKeydown}
  ></div>
  <div class="panel" class:right={align === "right"} style={width ? `width: ${width}px` : undefined} role="dialog" aria-label="Overlay" tabindex="-1">
    {@render children?.()}
  </div>
</div>

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: 70;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--overlay-dim);
    animation: backdrop-in 0.1s ease;
  }

  /* the outline is a floating side panel — no dim, click-away to close */
  .backdrop.right {
    background: transparent;
  }

  .panel {
    position: absolute;
    left: 50%;
    top: 17%;
    transform: translateX(-50%);
    width: 560px;
    max-width: calc(100vw - 48px);
    background: var(--popover);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .panel.right {
    top: 44px;
    right: 0;
    bottom: 0;
    left: auto;
    transform: none;
    width: 264px;
    max-width: 80vw;
    border-radius: 0;
    border-top: none;
    border-right: none;
    border-bottom: none;
  }

  /* subtle and fast — no fancy motion (spec §"visual design") */
  .panel {
    animation: panel-in 0.12s ease;
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
  }

  @keyframes panel-in {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }
</style>
