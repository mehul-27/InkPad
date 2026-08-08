<script lang="ts">
  import Sidebar from "./lib/components/Sidebar.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import EmptyState from "./lib/components/EmptyState.svelte";
  import DocumentPane from "./lib/components/DocumentPane.svelte";

  // ponytail: no document exists until Phase 2, so the empty state is
  // always shown and DocumentPane is the Reading/Edit shell.
  const documentOpen = false;
</script>

<div class="app">
  <Sidebar />

  <div class="main">
    <Toolbar />
    {#if documentOpen}
      <DocumentPane />
    {:else}
      <EmptyState />
    {/if}
  </div>
</div>

<style>
  .app {
    display: flex;
    height: 100%;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
</style>
