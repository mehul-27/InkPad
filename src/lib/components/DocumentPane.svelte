<script lang="ts">
  import { mode, doc } from "../stores";
  import Reader from "./Reader.svelte";
  import Editor from "./Editor.svelte";
  import SplitView from "./SplitView.svelte";

  // Phase 6: three modes, resolved from the format registry. Split and
  // Reading apply only to formats whose reader is Markdown; every other
  // format stays in the editor (spec §23) — no fake reading view.
</script>

{#if $mode === "split" && $doc?.format.splitSupported}
  <SplitView />
{:else if $mode === "reading" && $doc?.format.reader === "markdown"}
  <Reader />
{:else}
  <Editor />
{/if}