import { writable, get } from "svelte/store";
import type { Document } from "./docs";

export type Mode = "reading" | "edit" | "split";
export type Theme = "dark" | "light" | "system";
export type SaveState = "saved" | "saving" | "unsaved";

export const mode = writable<Mode>("reading");
export const sidebarOpen = writable(true);

// Theme: dark/light/system. System resolves through the OS media query and
// tracks live changes. The effective value is applied via `data-theme` on
// <html>, which every semantic token reads (spec §7).
const media = window.matchMedia("(prefers-color-scheme: light)");

function resolveTheme(value: Theme): "dark" | "light" {
  return value === "system" ? (media.matches ? "light" : "dark") : value;
}

const storedTheme = localStorage.getItem("inkpad-theme");
export const theme = writable<Theme>(
  storedTheme === "light" || storedTheme === "system" ? storedTheme : "dark",
);

theme.subscribe((value) => {
  document.documentElement.dataset.theme = resolveTheme(value);
  localStorage.setItem("inkpad-theme", value);
});

media.addEventListener("change", () => {
  if (get(theme) === "system") {
    document.documentElement.dataset.theme = resolveTheme("system");
  }
});

export const doc = writable<Document | null>(null);
export const recentFiles = writable<string[]>([]);
export const saveState = writable<SaveState>("saved");
export const dropActive = writable(false);

// Distraction-free (Phase 6): hides the sidebar and toolbar chrome; the
// document stays centered at reading width. Ctrl+Shift+F toggles, Esc exits.
export const distractionFree = writable(false);

// Which overlay is open (Phase 5). Setting a new kind replaces the current
// overlay; setting the same kind keeps it open. Esc closes it.
export type Overlay = "palette" | "files" | "outline" | "settings" | "new";
export const overlay = writable<Overlay | null>(null);

// One-shot commands addressed to the editor from outside (keyboard
// shortcuts, command palette, outline). The Editor component consumes each
// command by resetting this store to null.
export type EditorCommand =
  | { kind: "search" }
  | { kind: "replace" }
  | { kind: "goto-line"; line: number };
export const editorCommand = writable<EditorCommand | null>(null);