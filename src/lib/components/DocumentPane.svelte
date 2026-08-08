<script lang="ts">
  import { mode, doc, saveState } from "../stores";
  import Reader from "./Reader.svelte";

  // ponytail: editing is a plain textarea until Phase 4 (CodeMirror).
  // Plain-text documents always use the editor (spec §23).

  function onInput(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    doc.update((d) => (d ? { ...d, content: value, dirty: true } : d));
    saveState.set("unsaved");
  }
</script>

{#if $mode === "reading" && $doc?.language === "markdown"}
  <Reader />
{:else}
  <div class="editing-pane">
    <textarea
      class="editor"
      spellcheck="false"
      value={$doc?.content ?? ""}
      oninput={onInput}
    ></textarea>
  </div>
{/if}

<style>
  .editing-pane {
    height: 100%;
    background: var(--code-background);
    padding: 16px 0;
    overflow: hidden;
  }

  .editor {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0 24px;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--code);
    font-family: "JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace;
    font-size: 14px;
    line-height: 1.7;
    caret-color: var(--accent);
  }
</style>
