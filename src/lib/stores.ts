import { writable } from "svelte/store";
import type { Document } from "./docs";

export type Mode = "reading" | "edit";
export type Theme = "dark" | "light";
export type SaveState = "saved" | "unsaved";

export const mode = writable<Mode>("reading");
export const sidebarOpen = writable(true);

const storedTheme = localStorage.getItem("inkpad-theme") as Theme | null;
export const theme = writable<Theme>(storedTheme === "light" ? "light" : "dark");

theme.subscribe((value) => {
  document.documentElement.dataset.theme = value;
  localStorage.setItem("inkpad-theme", value);
});

export const doc = writable<Document | null>(null);
export const recentFiles = writable<string[]>([]);
export const saveState = writable<SaveState>("saved");
export const dropActive = writable(false);
