// Document lifecycle actions shared by toolbar, sidebar, empty state, and
// drag-and-drop. Smallest orchestration layer; all I/O goes through api.ts.

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
import { doc, recentFiles, saveState } from "./stores";

export async function refreshRecents(): Promise<void> {
  recentFiles.set(await getRecentFiles());
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!get(doc)?.dirty) return true;
  const ok = await confirm(
    `${get(doc)?.filename} has unsaved changes. Discard them?`,
    { title: "InkPad", kind: "warning" },
  );
  return ok;
}

export async function openPath(path: string): Promise<void> {
  if (!isSupportedFile(path)) return;
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

export async function saveDocument(): Promise<void> {
  const current = get(doc);
  if (!current) return;
  try {
    await writeTextFile(current.path, current.content);
    doc.update((d) => (d ? { ...d, dirty: false } : d));
    saveState.set("saved");
  } catch (e) {
    message(String(e), { title: "InkPad", kind: "error" });
  }
}

export async function saveDocumentAs(): Promise<void> {
  const current = get(doc);
  if (!current) return;
  const picked = await pickFileToSave(current.path);
  if (!picked) return;
  // re-derive document identity from the new path (spec §22)
  doc.set(createDocument(picked, current.content));
  await addRecentFile(picked);
  await refreshRecents();
  await saveDocument();
}

export async function closeDocument(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return;
  doc.set(null);
  saveState.set("saved");
}

export function revealDocument(): void {
  const current = get(doc);
  if (current) revealInExplorer(current.path);
}
