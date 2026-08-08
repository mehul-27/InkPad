<script lang="ts">
  import { mode, doc, saveState } from "../stores";
  import { saveDocument } from "../actions";

  // ponytail: reading pane shows raw source until Phase 3 (markdown-it);
  // editing is a plain textarea until Phase 4 (CodeMirror). Plain-text
  // documents always use the editor (spec §23).

  function onInput(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    doc.update((d) => (d ? { ...d, content: value, dirty: true } : d));
    saveState.set("unsaved");
  }
</script>

{#if $mode === "reading" && $doc?.language === "markdown"}
  <div class="reading-pane">
    <div class="reading-column">
      <div class="raw-content">{ $doc.content }</div>
    </div>
  </div>
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

  .raw-content {
    font-size: 16px;
    line-height: 1.75;
    color: var(--prose);
    white-space: pre-wrap;
    word-break: break-word;
  }

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
