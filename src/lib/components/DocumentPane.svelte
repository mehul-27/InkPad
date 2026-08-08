<script lang="ts">
  import { mode } from "../stores";
</script>

<!-- ponytail: shell only — reading content arrives in Phase 3
     (markdown-it), editing in Phase 4 (CodeMirror). -->

{#if $mode === "reading"}
  <div class="reading-pane">
    <div class="reading-column">
      <div class="placeholder-text">Reading view</div>
    </div>
  </div>
{:else}
  <div class="editing-pane">
    <div class="placeholder-text mono">Edit view</div>
  </div>
{/if}

<style>
  .reading-pane {
    height: 100%;
    overflow-y: auto;
    padding: 48px 32px;
  }

  .reading-column {
    max-width: 820px;
    margin: 0 auto;
    min-height: calc(100% - 96px);
  }

  .editing-pane {
    height: 100%;
    overflow-y: auto;
    padding: 16px 24px;
    background: var(--code-background);
  }

  .placeholder-text {
    color: var(--muted-foreground);
    font-size: 14px;
  }

  .mono {
    font-family: "JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace;
    font-size: 14px;
    line-height: 1.7;
  }
</style>
