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
  readerSupported,
  resolveSaveTarget,
  DEFAULT_FORMAT,
  type DocumentFormat,
} from "./docs";
import {
  pickFileToOpen,
  pickFileToSave,
  readTextFile,
  writeTextFile,
  fileModified,
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  revealInExplorer,
  getStartupFile,
  getWelcomeFile,
} from "./api";
import { doc, mode, recentFiles, saveState, editorCommand, overlay, distractionFree } from "./stores";
import type { EditorCommand } from "./stores";
import { settings } from "./settings";
import { prewarmEditorLanguage } from "./languages";

export const AUTOSAVE_DELAY = 750;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function cancelAutosave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

// Mode for a document that is being activated (opened, or replaced): Markdown
// opens in its rendered Reading view, every other format has a single editor
// surface. Applied on every document activation so mode state can never be
// stale — there is no path where a non-Markdown document sits in reading or
// split mode.
function setDocumentMode(format: DocumentFormat): void {
  mode.set(readerSupported(format) ? "reading" : "edit");
  // Perf (Fix C): prewarm the editor language of the document being opened
  // so the first edit never waits on the deferred language chunk (the
  // editor's plain-text-no-syntax start has zero typing lag regardless).
  prewarmEditorLanguage(format.editorLanguage);
}

// Save As can change a document's format in place (md -> py and back). Keep
// the current mode when it is still valid for the new format; drop to the
// editor when it is not. Deliberately does not force Reading, so saving does
// not yank the user out of the editor.
function normalizeMode(format: DocumentFormat): void {
  if (!readerSupported(format) && get(mode) !== "edit") mode.set("edit");
}

// ---- Perf (Fix D): content cache -------------------------------------------
// Re-opening a document re-read the file over IPC every time, even when the
// frontend had just read or written the exact same bytes. A small bounded
// path → content cache now sits in front of the IPC read:
//   - entry = { content, mtime } (millis since epoch);
//   - a hit validates with ONE metadata-only IPC (file_modified) before the
//     content is served, so a file modified outside InkPad (between close
//     and re-open) is never served stale;
//   - every read fills the cache, and every write by the app (autosave,
//     Save, Save As) replaces its entry — never more than CONTENT_CACHE_SIZE
//     documents are kept.
const CONTENT_CACHE_SIZE = 6;

interface ContentCacheEntry {
  content: string;
  mtime: number;
}

const contentCache = new Map<string, ContentCacheEntry>();

function cachePut(path: string, entry: ContentCacheEntry): void {
  contentCache.delete(path); // refresh insertion order (LRU)
  contentCache.set(path, entry);
  while (contentCache.size > CONTENT_CACHE_SIZE) {
    const oldest = contentCache.keys().next().value;
    if (oldest === undefined) break;
    contentCache.delete(oldest);
  }
}

/// Content of `path`, served from the cache when the file's modified time
/// still matches the cached one; otherwise a full IPC read (cached again).
async function readFileCached(path: string): Promise<string> {
  const entry = contentCache.get(path);
  if (entry) {
    const mtime = await fileModified(path);
    if (mtime !== null && mtime === entry.mtime) {
      cachePut(path, entry); // refresh insertion order
      return entry.content;
    }
    contentCache.delete(path);
  }
  // stat first, read second: an external write between the two leaves the
  // stored mtime older than the disk file, so the NEXT validation fails and
  // the fresh content is re-used — the stale window closes immediately
  const storedMtime = await fileModified(path);
  const content = await readTextFile(path);
  if (storedMtime !== null) cachePut(path, { content, mtime: storedMtime });
  return content;
}

/// Write + cache refresh: after the bytes are on disk the entry is replaced
/// with the written content (mtime re-read) so re-opens keep hitting.
async function writeFileCached(path: string, content: string): Promise<void> {
  await writeTextFile(path, content);
  const mtime = await fileModified(path);
  if (mtime === null) {
    contentCache.delete(path);
  } else {
    cachePut(path, { content, mtime });
  }
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
    await writeFileCached(current.path, current.content);
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

// ---- Perf (Fix C): parallel boot -------------------------------------------
// Boot used to serialize three IPC round-trips: refreshRecents →
// getStartupFile → the initial document read. They now overlap: the recents
// refresh (IPC 1) and the startup-file lookup (IPC 2) run concurrently, and
// the first content read (IPC 3) fires the moment its path is known — while
// the other two may still be in flight.
//
// The final state is the same as the sequential boot produced: the startup
// file opens (else the bundled welcome, else the most recent file), and the
// recents list ends up containing the opened document. To guarantee that the
// initial recents snapshot can never land after the document has been added
// to the history, the snapshot is awaited between the content read and the
// add-to-recents step — the post-open refresh is then the last write.

/// Open the boot document. Same result as openPath at startup (where save
/// flush / dirty-discard confirmations are guaranteed no-ops), but the read
/// overlaps the still-running initial recents refresh instead of queueing
/// behind it.
export async function openStartupDocument(
  path: string,
  recentsReady: Promise<void>,
): Promise<void> {
  if (!isSupportedFile(path)) return;
  try {
    const content = await readFileCached(path);
    // the initial snapshot must land before this document is added to the
    // recents list, so it can never overwrite the post-open refresh
    await recentsReady;
    const next = createDocument(path, content);
    doc.set(next);
    saveState.set("saved");
    setDocumentMode(next.format);
    await addRecentFile(path);
    await refreshRecents();
  } catch (e) {
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

// Launch priority (§ onboarding), now with overlapped IPC: a file passed on
// the command line ("Open with InkPad") wins; otherwise the bundled welcome
// opens on the first-ever launch; otherwise the most recent document is
// restored when one exists; otherwise the empty state shows.
export async function boot(): Promise<void> {
  const recentsReady = refreshRecents(); // IPC 1 (not awaited yet)
  const startupPath = await getStartupFile(); // IPC 2 — runs during IPC 1
  if (startupPath) {
    await openStartupDocument(startupPath, recentsReady); // read overlaps IPC 1
    return;
  }
  await recentsReady;
  const welcomePath = await getWelcomeFile();
  if (welcomePath) {
    await openWelcome(welcomePath);
    return;
  }
  const recents = get(recentFiles);
  if (recents.length > 0) {
    await openStartupDocument(recents[0], recentsReady);
  }
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
  // Perf (Fix D): re-opening the document that is already open must not
  // re-read. After the flush above the in-memory content is exactly what is
  // on disk (and an unsaved-but-kept document would have bailed out at the
  // discard prompt), so re-read from memory instead of the file. The
  // resulting store state is identical to what the disk read produced:
  // a fresh Document id, non-dirty, mode re-applied, recents refreshed.
  const open = get(doc);
  if (open && open.path === path && !open.dirty) {
    const next = createDocument(path, open.content);
    doc.set(next);
    saveState.set("saved");
    setDocumentMode(next.format);
    await addRecentFile(path);
    await refreshRecents();
    return;
  }
  try {
    const content = await readFileCached(path);
    const next = createDocument(path, content);
    doc.set(next);
    saveState.set("saved");
    setDocumentMode(next.format);
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
    const content = await readFileCached(path);
    const next = createDocument(path, content, true);
    doc.set(next);
    saveState.set("saved");
    setDocumentMode(next.format);
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
// touched: `path` stays null until the first save. A brand-new document is
// always something the user intends to write, so it opens in the editor —
// including Markdown, which would otherwise start in the rendered Reading
// view.
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
    await writeFileCached(target.path, current.content);
    const next = createDocument(target.path, current.content);
    doc.set(next);
    normalizeMode(next.format);
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
// Modes are a Markdown-only concept: Reading (rendered) and Edit (source) are
// two representations of the same Markdown, and Split shows both. Every other
// format has a single editor surface, so its mode commands are no-ops.

export function toggleMode(): void {
  const current = get(doc);
  if (!current || !readerSupported(current.format)) return;
  mode.set(get(mode) === "reading" ? "edit" : "reading");
}

// Ctrl+Shift+E: split view (Markdown only). Closing split returns to the
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
