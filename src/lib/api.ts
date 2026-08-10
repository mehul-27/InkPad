// Thin wrappers over Tauri native functionality. No logic beyond plumbing.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

const FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown"] },
  { name: "Text", extensions: ["txt"] },
];

export async function pickFileToOpen(): Promise<string | null> {
  const picked = await openDialog({ multiple: false, filters: FILTERS });
  return typeof picked === "string" ? picked : null;
}

export async function pickFileToSave(defaultPath?: string): Promise<string | null> {
  const picked = await saveDialog({ defaultPath, filters: FILTERS });
  return typeof picked === "string" ? picked : null;
}

export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content });
export const readImageData = (path: string) =>
  invoke<{ mime: string; data: string } | null>("read_image_data", { path });
export const getRecentFiles = () => invoke<string[]>("get_recent_files");
export const addRecentFile = (path: string) => invoke<void>("add_recent_file", { path });
export const revealInExplorer = (path: string) => invoke<void>("reveal_in_explorer", { path });
export const getStartupFile = () => invoke<string | null>("get_startup_file");
export const getWelcomeFile = () => invoke<string | null>("get_welcome_file");

// Second-instance launches (double-clicking an associated file while InkPad
// is running) arrive here via the single-instance plugin.
export function onOpenFileRequest(cb: (path: string) => void): Promise<() => void> {
  return getCurrentWindow().listen<string>("open-file", (e) => cb(e.payload));
}

export function onDragDrop(cb: (paths: string[], active: boolean) => void): Promise<() => void> {
  let lastPaths: string[] = [];
  return getCurrentWindow().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "enter") {
      lastPaths = payload.paths;
      cb(payload.paths, true);
    } else if (payload.type === "over") {
      cb(lastPaths, true);
    } else if (payload.type === "drop") {
      cb(payload.paths, false);
    } else {
      cb([], false);
    }
  });
}
