<script lang="ts">
  // Phase 5: document outline (Ctrl+Shift+O). Heading list extracted from
  // the markdown with the renderer's own parser and slug logic, so outline
  // entries and heading anchors stay in sync. In Reading mode a click
  // scrolls to the rendered heading; in Edit mode the cursor jumps there.
  // Plain-text documents and documents without headings show an empty state.

  import Overlay from "./Overlay.svelte";
  import { extractHeadings, type MarkdownHeading } from "../markdown";
  import { doc, editorCommand, mode, overlay } from "../stores";

  const headings = $derived(
    $doc?.language === "markdown" ? extractHeadings($doc?.content ?? "") : [],
  );

  function goTo(heading: MarkdownHeading): void {
    overlay.set(null);
    if ($mode === "reading" || $mode === "split") {
      document
        .querySelector(`.reading-column #${CSS.escape(heading.slug)}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      editorCommand.set({ kind: "goto-line", line: heading.line + 1 });
    }
  }
</script>

<Overlay align="right">
  <div class="outline">
    <div class="header">Outline</div>
    <div class="list">
      {#each headings as heading (heading.line + heading.text)}
        <button
          type="button"
          class="item"
          style="--level-indent: {heading.level - 1}em"
          onclick={() => goTo(heading)}
        >{heading.text || "Untitled heading"}</button>
      {/each}
      {#if headings.length === 0}
        <div class="empty">No Markdown headings to show.</div>
      {/if}
    </div>
  </div>
</Overlay>

<style>
  .outline {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .header {
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground);
    border-bottom: 1px solid var(--hairline);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }

  .item {
    display: block;
    width: 100%;
    padding: 5px 10px;
    margin: 1px 0;
    padding-left: calc(10px + var(--level-indent));
    border-radius: 5px;
    font-size: 12.5px;
    font-weight: 450;
    text-align: left;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item:hover {
    background: var(--surface-raised);
    color: var(--accent);
  }

  .empty {
    padding: 24px 14px;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted-foreground);
  }
</style>
