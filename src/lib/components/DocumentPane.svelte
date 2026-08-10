<script lang="ts">
  import { mode, doc } from "../stores";
  import Reader from "./Reader.svelte";
  import Editor from "./Editor.svelte";
  import SplitView from "./SplitView.svelte";

  // Phase 6: three modes. Split (markdown only) shows the same Editor and
  // Reader panes over the single authoritative `doc` store. Plain-text
  // documents always use the editor (spec §23) — no split, no Reader.
</script>

{#if $mode === "split" && $doc?.language === "markdown"}
  <SplitView />
{:else if $mode === "reading" && $doc?.language === "markdown"}
  <Reader />
{:else}
  <Editor />
{/if}