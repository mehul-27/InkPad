// Document lifecycle actions shared by toolbar, sidebar, empty state, editor,
// and drag-and-drop. The `doc` store is the single authoritative source of
// document content: the editor pushes every change into it, the Reader
// derives from it, and autosave reads from it (spec §"document state").

import { get } from "svelte/store";
import { message, confirm } from "@tauri-apps/plugin-dialog";
import { createDocument, isSupportedFile } from "./docs";
import {
  pickFileToOpen,
  pickFileToSave,
  readTextFile,
  writeTextFile,
  getRecentFiles,
  addRecentFile,
  revealInExplorer,
} from "./api";
import { doc, mode, recentFiles, saveState, editorCommand, overlay, distractionFree } from "./stores";
import type { EditorCommand } from "./stores";
import { settings } from "./settings";

export const AUTOSAVE_DELAY = 750;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function cancelAutosave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

// Editor calls this on every change: content goes into the authoritative
// store immediately, save is debounced ~750ms after the last edit (§25).
// The bundled welcome document is exempt from autosave — it only persists
// via Save As (§ onboarding). Autosave can be disabled in Settings; the
// document still marks itself dirty, and explicit saves still work.
export function markDocumentDirty(content: string): void {
  const current = get(doc);
  if (!current) return;
  doc.set({ ...current, content, dirty: true });
  saveState.set("unsaved");
  if (current.welcome || !get(settings).autosave) return;
  cancelAutosave();
  saveTimer = setTimeout(() => void flushSave(), AUTOSAVE_DELAY);
}

// Save now if there is anything dirty. Cancels any pending debounce; safe
// to call from Ctrl+S, document switches, window blur, and close.
export async function flushSave(): Promise<void> {
  cancelAutosave();
  const current = get(doc);
  if (!current || !current.dirty) return;
  if (current.welcome) {
    // bundled document: saving means "save a copy" — the normal Save As flow
    await saveDocumentAs();
    return;
  }
  saveState.set("saving");
  try {
    await writeTextFile(current.path, current.content);
    doc.update((d) => (d ? { ...d, dirty: false } : d));
    saveState.set("saved");
  } catch (e) {
    saveState.set("unsaved");
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

export async function saveDocument(): Promise<void> {
  await flushSave();
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!get(doc)?.dirty) return true;
  const ok = await confirm(
    `${get(doc)?.filename} has unsaved changes. Discard them?`,
    { title: "InkPad", kind: "warning" },
  );
  return ok;
}

export async function refreshRecents(): Promise<void> {
  recentFiles.set(await getRecentFiles());
}

export async function openPath(path: string): Promise<void> {
  if (!isSupportedFile(path)) return;
  // switching documents saves first (§25) — unless autosave is off, in
  // which case the discard prompt below decides what happens to the edits
  if (get(settings).autosave) await flushSave();
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const content = await readTextFile(path);
    doc.set(createDocument(path, content));
    saveState.set("saved");
    await addRecentFile(path);
    await refreshRecents();
  } catch (e) {
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

export async function openDocument(): Promise<void> {
  const picked = await pickFileToOpen();
  if (picked) await openPath(picked);
}

// First-launch welcome: opens in Reading mode and never touches the
// recent-files list (§ onboarding).
export async function openWelcome(path: string): Promise<void> {
  try {
    const content = await readTextFile(path);
    doc.set(createDocument(path, content, true));
    saveState.set("saved");
    mode.set("reading");
  } catch (e) {
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

export async function saveDocumentAs(): Promise<void> {
  const current = get(doc);
  if (!current) return;
  const picked = await pickFileToSave(current.path);
  if (!picked) return;
  cancelAutosave();
  saveState.set("saving");
  try {
    // write the new path first — the document identity only changes once
    // the bytes are safely on disk
    await writeTextFile(picked, current.content);
    doc.set(createDocument(picked, current.content));
    saveState.set("saved");
    await addRecentFile(picked);
    await refreshRecents();
  } catch (e) {
    saveState.set("unsaved");
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

export async function closeDocument(): Promise<void> {
  if (get(settings).autosave) await flushSave();
  if (!(await confirmDiscardIfDirty())) return;
  doc.set(null);
  saveState.set("saved");
}

export function revealDocument(): void {
  const current = get(doc);
  if (current) revealInExplorer(current.path);
}

// ---- Phase 5/6: view / search actions for shortcuts and the palette -------
// Phase 6 modes: reading (default), edit, split (markdown only). The
// primary toggle (Ctrl+E) alternates reading and edit; from split it lands
// on edit — the pane the user's cursor is already in.

export function toggleMode(): void {
  const current = get(doc);
  if (!current) return;
  if (current.language !== "markdown") {
    mode.set("edit"); // plain text has no reading view (spec §23)
    return;
  }
  mode.set(get(mode) === "reading" ? "edit" : "reading");
}

// Ctrl+Shift+E: split view (markdown only). Closing split returns to the
// reader — the primary InkPad experience.
export function toggleSplit(): void {
  const current = get(doc);
  if (!current || current.language !== "markdown") return;
  mode.set(get(mode) === "split" ? "reading" : "split");
}

// Ctrl+Shift+F: distraction-free. Hiding chrome is a purely visual state;
// Esc and the same shortcut both leave it.
export function toggleDistractionFree(): void {
  distractionFree.set(!get(distractionFree));
}

// Ctrl+F / Ctrl+H when the focus is NOT inside the CodeMirror editor: the
// editor's own keymap owns those keys while it has focus. Outside it, the
// document is opened in Edit mode and the panel is opened once the editor
// mounts (it consumes the command from the store).
function sendEditorCommand(command: EditorCommand): void {
  if (!get(doc)) return;
  if (document.activeElement?.closest(".cm-editor")) return;
  overlay.set(null); // a palette/switcher on top would hide the result
  mode.set("edit");
  editorCommand.set(command);
}

export function requestSearch(): void {
  sendEditorCommand({ kind: "search" });
}

export function requestReplace(): void {
  sendEditorCommand({ kind: "replace" });
}
