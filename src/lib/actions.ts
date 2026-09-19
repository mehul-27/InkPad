// Document lifecycle actions shared by toolbar, sidebar, empty state, editor,
// and drag-and-drop. The `doc` store is the single authoritative source of
// document content: the editor pushes every change into it, the Reader
// derives from it, and autosave reads from it (spec §"document state").
//
// A document may be brand-new and never saved: `path` is null and `filename`
// is a generated "Untitled.ext". Such a document is never autosaved (there is
// no file to write), Ctrl+S routes to Save As, and closing uses the discard
// confirmation.

import { get } from "svelte/store";
import { message, confirm } from "@tauri-apps/plugin-dialog";
import {
  createDocument,
  createUntitledDocument,
  formatById,
  isSupportedFile,
  resolveSaveTarget,
  DEFAULT_FORMAT,
  type DocumentFormat,
} from "./docs";
import {
  pickFileToOpen,
  pickFileToSave,
  readTextFile,
  writeTextFile,
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
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

// Formats without a reading view can never sit in reading/split mode.
function applyFormatMode(format: DocumentFormat): void {
  if (format.reader !== "markdown" && get(mode) !== "edit") mode.set("edit");
}

// Editor calls this on every change: content goes into the authoritative
// store immediately, save is debounced ~750ms after the last edit (§25).
// The bundled welcome document and unsaved new documents are exempt from
// autosave — there is no writable target. Autosave can be disabled in
// Settings; the document still marks itself dirty and explicit saves work.
export function markDocumentDirty(content: string): void {
  const current = get(doc);
  if (!current) return;
  doc.set({ ...current, content, dirty: true });
  saveState.set("unsaved");
  if (current.welcome || current.path === null || !get(settings).autosave) return;
  cancelAutosave();
  saveTimer = setTimeout(() => void flushSave(), AUTOSAVE_DELAY);
}

// Background save: writes the current document to its own path. A no-op when
// there is nothing dirty, nothing to write to (unsaved new document), or the
// bundled welcome document. Never opens a dialog — safe to call from the
// autosave timer, window blur, document switches, and window close.
export async function flushSave(): Promise<void> {
  cancelAutosave();
  const current = get(doc);
  if (!current || !current.dirty) return;
  if (current.path === null) return;
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

// The explicit "Save" action (Ctrl+S, menu, palette): a saved file is written
// in place; a new, never-saved document (or the welcome document) goes
// through Save As so the user can pick a name, location and format.
export async function saveDocument(): Promise<void> {
  const current = get(doc);
  if (!current) return;
  if (current.path === null || current.welcome) {
    await saveDocumentAs();
    return;
  }
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

// Remove one entry from the recent-files list (sidebar context menu). The
// file on disk is untouched and an open document stays open — only the
// history entry goes away.
export async function removeRecentPath(path: string): Promise<void> {
  try {
    await removeRecentFile(path);
    await refreshRecents();
  } catch (e) {
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

export async function openPath(path: string): Promise<void> {
  if (!isSupportedFile(path)) return;
  // switching documents saves first (§25) — unless autosave is off, in
  // which case the discard prompt below decides what happens to the edits
  if (get(settings).autosave) await flushSave();
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const content = await readTextFile(path);
    const next = createDocument(path, content);
    doc.set(next);
    saveState.set("saved");
    applyFormatMode(next.format);
    await addRecentFile(path);
    await refreshRecents();
  } catch (e) {
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

export async function openDocument(): Promise<void> {
  let picked: string | null = null;
  try {
    picked = await pickFileToOpen();
  } catch (e) {
    message(String(e), { title: "InkPad", kind: "error" });
    return;
  }
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

// Ctrl+N / File → New: guard the current document's unsaved work with the
// same lifecycle used when switching documents, then open the New Document
// dialog. Nothing is created until the user confirms.
export async function requestNewDocument(): Promise<void> {
  if (get(settings).autosave) await flushSave();
  if (!(await confirmDiscardIfDirty())) return;
  overlay.set("new");
}

// Create the in-memory document chosen in the New Document dialog. No file is
// touched: `path` stays null until the first save.
export function createNewDocument(formatId: string, filename: string): void {
  const format = formatById(formatId) ?? DEFAULT_FORMAT;
  const next = createUntitledDocument(format, filename);
  cancelAutosave();
  editorCommand.set(null);
  doc.set(next);
  mode.set("edit");
  saveState.set("saved");
}

export async function saveDocumentAs(): Promise<void> {
  const current = get(doc);
  if (!current) return;
  let picked: string | null = null;
  try {
    picked = await pickFileToSave(current.path ?? current.filename, current.format);
  } catch (e) {
    // a failed/invalid dialog must not be swallowed as an unhandled rejection
    message(String(e), { title: "InkPad", kind: "error" });
    return;
  }
  if (!picked) return;
  const target = resolveSaveTarget(picked, current.format);
  if (!target) {
    message(
      "InkPad can't save files with that extension. Choose one of the supported file types.",
      { title: "InkPad", kind: "error" },
    );
    return;
  }
  cancelAutosave();
  saveState.set("saving");
  try {
    // write the new path first — the document identity only changes once
    // the bytes are safely on disk
    await writeTextFile(target.path, current.content);
    const next = createDocument(target.path, current.content);
    doc.set(next);
    applyFormatMode(next.format);
    saveState.set("saved");
    await addRecentFile(target.path);
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

// Window close (the X button): already-saved edits are written; a never-saved
// document uses the discard confirmation instead of forcing a Save As.
export async function confirmWindowClose(): Promise<boolean> {
  const current = get(doc);
  if (!current || !current.dirty) return true;
  if (current.path === null) return confirmDiscardIfDirty();
  await flushSave();
  return !get(doc)?.dirty;
}

export function revealDocument(): void {
  const current = get(doc);
  if (!current?.path) return;
  void revealInExplorer(current.path).catch((e) => {
    message(String(e), { title: "InkPad", kind: "error" });
  });
}

// ---- Phase 5/6: view / search actions for shortcuts and the palette -------
// Phase 6 modes: reading (default), edit, split (markdown only). The
// primary toggle (Ctrl+E) alternates reading and edit; from split it lands
// on edit — the pane the user's cursor is already in.

export function toggleMode(): void {
  const current = get(doc);
  if (!current) return;
  if (current.format.reader !== "markdown") {
    mode.set("edit"); // formats without a reader have no reading view
    return;
  }
  mode.set(get(mode) === "reading" ? "edit" : "reading");
}

// Ctrl+Shift+E: split view (markdown only). Closing split returns to the
// reader — the primary InkPad experience.
export function toggleSplit(): void {
  const current = get(doc);
  if (!current || !current.format.splitSupported) return;
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
