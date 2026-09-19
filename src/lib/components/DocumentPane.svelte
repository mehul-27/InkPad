<script lang="ts">
  import { mode, doc } from "../stores";
  import Reader from "./Reader.svelte";
  import Editor from "./Editor.svelte";
  import SplitView from "./SplitView.svelte";
  import { readerSupported } from "../docs";

  // Markdown is the only format with two useful representations (rendered and
  // source), so Reading and Split exist only where the registry says a reader
  // does. Every other format has exactly one surface: the editor. The
  // capabilities come from the format registry — there is no Markdown list
  // here.
  const canRead = $derived($doc != null && readerSupported($doc.format));
  const canSplit = $derived($doc != null && $doc.format.splitSupported);
</script>

{#if canSplit && $mode === "split"}
  <SplitView />
{:else if canRead && $mode === "reading"}
  <Reader />
{:else}
  <Editor />
{/if}