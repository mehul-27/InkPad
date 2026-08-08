import { writable } from "svelte/store";

export type Mode = "reading" | "edit";
export type Theme = "dark" | "light";

export const mode = writable<Mode>("reading");
export const sidebarOpen = writable(true);

const storedTheme = localStorage.getItem("inkpad-theme") as Theme | null;
export const theme = writable<Theme>(storedTheme === "light" ? "light" : "dark");

theme.subscribe((value) => {
  document.documentElement.dataset.theme = value;
  localStorage.setItem("inkpad-theme", value);
});
