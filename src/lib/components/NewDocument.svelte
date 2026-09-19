<script lang="ts">
  // New Document dialog (Ctrl+N / File → New). Purely in-memory: it only
  // gathers a format and a name, then hands them to createNewDocument — no
  // file is created on disk. The format list and default names both come from
  // the central format registry, so a new format needs no change here.

  import Overlay from "./Overlay.svelte";
  import { overlay } from "../stores";
  import {
    DOCUMENT_FORMATS,
    DEFAULT_FORMAT,
    baseNameOf,
    defaultExtension,
    defaultFilename,
    extensionOf,
    formatById,
    formatForExtension,
    type DocumentFormat,
  } from "../docs";
  import { createNewDocument } from "../actions";

  interface FormatGroup {
    name: string;
    formats: DocumentFormat[];
  }

  // formats grouped for the <optgroup> headings, in registry order
  const groups: FormatGroup[] = [];
  {
    const index = new Map<string, FormatGroup>();
    for (const format of DOCUMENT_FORMATS) {
      let group = index.get(format.group);
      if (!group) {
        group = { name: format.group, formats: [] };
        index.set(format.group, group);
        groups.push(group);
      }
      group.formats.push(format);
    }
  }

  let formatId = $state(DEFAULT_FORMAT.id);
  let filename = $state(defaultFilename(DEFAULT_FORMAT));
  let filenameTouched = $state(false);
  let inputEl: HTMLInputElement | undefined;

  const canCreate = $derived(filename.trim().length > 0);

  $effect(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  // While the name is still the generated "Untitled.ext", follow the format.
  // Once the user edits it, preserve their text and only swap a recognised
  // extension (so "notes.md" + Python becomes "notes.py", plain "notes" stays).
  function applyFormat(nextId: string): void {
    const next = formatById(nextId);
    if (!next) return;
    formatId = next.id;
    if (!filenameTouched) {
      filename = defaultFilename(next);
      return;
    }
    const ext = extensionOf(filename);
    if (ext && formatForExtension(ext)) {
      filename = `${baseNameOf(filename)}.${defaultExtension(next)}`;
    }
  }

  function create(): void {
    const name = filename.trim();
    if (!name) return;
    overlay.set(null);
    createNewDocument(formatId, name);
  }

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault();
    create();
  }
</script>

<Overlay width={440}>
  <form class="new-doc" onsubmit={onSubmit}>
    <h2 class="title">New Document</h2>

    <label class="field">
      <span class="label">File type</span>
      <select bind:value={formatId} onchange={(e) => applyFormat(e.currentTarget.value)}>
        {#each groups as group (group.name)}
          <optgroup label={group.name}>
            {#each group.formats as format (format.id)}
              <option value={format.id}>{format.label} (.{defaultExtension(format)})</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>

    <label class="field">
      <span class="label">File name</span>
      <input
        type="text"
        bind:value={filename}
        bind:this={inputEl}
        oninput={() => (filenameTouched = true)}
        spellcheck="false"
      />
    </label>

    <div class="actions">
      <button class="btn" type="button" onclick={() => overlay.set(null)}>Cancel</button>
      <button class="btn primary" type="submit" disabled={!canCreate}>Create</button>
    </div>
  </form>
</Overlay>

<style>
  .new-doc {
    display: flex;
    flex-direction: column;
    padding: 4px 20px 18px;
  }

  .title {
    margin: 12px 0 14px;
    font-size: 15px;
    font-weight: 650;
    color: var(--foreground);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  select,
  input {
    width: 100%;
    padding: 8px 10px;
    background: var(--background);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
    outline: none;
  }

  select:focus,
  input:focus {
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }

  .btn {
    padding: 7px 16px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--foreground);
    background: var(--surface-raised);
    border: 1px solid var(--border);
  }

  .btn:hover {
    background: var(--popover);
  }

  .btn.primary {
    color: var(--accent-foreground);
    background: var(--accent);
    border-color: var(--accent);
  }

  .btn.primary:hover {
    opacity: 0.92;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
