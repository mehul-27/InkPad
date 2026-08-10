// Phase 6: user settings. Deliberately small (spec §"Settings") — only
// options that have an actual effect exist. Persisted in localStorage
// (the same mechanism the theme already used) as one JSON blob, applied
// live by the components that read the store.

import { writable, get } from "svelte/store";

export type ContentWidth = "comfortable" | "wide";
export type FontSize = "small" | "default" | "large";

export interface Settings {
  contentWidth: ContentWidth;
  readerFontSize: FontSize;
  editorFontSize: FontSize;
  wordWrap: boolean;
  autosave: boolean;
}

const DEFAULTS: Settings = {
  contentWidth: "comfortable",
  readerFontSize: "default",
  editorFontSize: "default",
  wordWrap: true,
  autosave: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem("inkpad-settings");
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = writable<Settings>(load());

let writing = false;
settings.subscribe((value) => {
  if (writing) return;
  writing = true;
  try {
    localStorage.setItem("inkpad-settings", JSON.stringify(value));
  } finally {
    writing = false;
  }
});

/** Settings writing helper used by the Settings panel. */
export function updateSettings(patch: Partial<Settings>): void {
  settings.set({ ...get(settings), ...patch });
}