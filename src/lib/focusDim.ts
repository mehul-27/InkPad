// Focus dimming (Ulysses-style, Phase "ui2"): while the CodeMirror editor has
// the focus in Edit or Split mode, the surrounding chrome (toolbar, sidebar,
// split divider) fades to a reduced opacity. Anything that touches the pointer,
// the focus, or the view mode restores the chrome instantly — the transition
// runs on opacity only, so no layout property is ever animated or measured
// here.
//
// State is one store bit (`focusDim`) plus a couple of module-local booleans;
// no per-frame work happens while the chrome is not dimmed:
//   - a single window mousemove listener is installed ONLY while dimmed, and
//     it is removed the moment the dim clears (rAF-throttled: at most one
//     restore per frame);
//   - focus tracking rides the browser's own focusin/blur events (passive);
//   - CodeMirror re-arms the dim on each real keystroke (armFocusDim), so
//     touching the mouse undims, and the next keystroke dims again.

import { get, writable } from "svelte/store";
import { mode } from "./stores";

/// True while the chrome should sit at reduced opacity. Consumed once in
/// App.svelte to toggle a class; the CSS owns the transition.
export const focusDim = writable(false);

export type DimCleanup = () => void;

let editorFocused = false;
/// Latch: set by any mouse move or mode change, cleared by the next "arm"
/// (editor focus or CodeMirror doc change) so dimming re-engages while typing.
let quiet = false;

let dimActive = false;
let mouseInstalled = false;
let mouseRaf = 0;
let started = false;

const listeners: Array<() => void> = [];

function insideEditor(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(".cm-editor");
}

function setDim(next: boolean): void {
  if (next === dimActive) return;
  dimActive = next;
  focusDim.set(next);
  if (next) installMouseMove();
  else uninstallMouseMove();
}

function recompute(): void {
  if (get(mode) === "reading") {
    // no dimming in Reading mode, ever
    setDim(false);
    return;
  }
  setDim(editorFocused && !quiet);
}

function installMouseMove(): void {
  if (mouseInstalled) return;
  mouseInstalled = true;
  window.addEventListener("mousemove", onMouseMove, { passive: true });
}

function uninstallMouseMove(): void {
  if (!mouseInstalled) return;
  mouseInstalled = false;
  window.removeEventListener("mousemove", onMouseMove);
  if (mouseRaf) {
    cancelAnimationFrame(mouseRaf);
    mouseRaf = 0;
  }
}

/// rAF-throttled: the first mouse move schedules (once per frame) an instant
/// restore and detaches the shared listener — zero cost while not dimmed.
function onMouseMove(): void {
  if (mouseRaf) return;
  mouseRaf = requestAnimationFrame(() => {
    mouseRaf = 0;
    uninstallMouseMove();
    quiet = true;
    setDim(false);
  });
}

/// Re-engage dimming: called when focus enters the editor and on every real
/// CodeMirror keystroke (Editor.svelte's updateListener). Clears the mouse
/// latch so the chrome fades back while writing.
export function armFocusDim(): void {
  quiet = false;
  recompute();
}

function onFocusIn(event: FocusEvent): void {
  if (insideEditor(event.target)) {
    editorFocused = true;
    armFocusDim();
    return;
  }
  // focus moved somewhere else (toolbar button, sidebar, overlay, body)
  editorFocused = false;
  setDim(false);
}

function onWindowBlur(): void {
  editorFocused = false;
  setDim(false);
}

/// Starts the focus-dim wiring. Returns a cleanup for App.svelte's onMount
/// teardown (never runs again once torn down; keeps idempotent for HMR).
export function initFocusDim(): DimCleanup {
  if (started) return () => {};
  started = true;

  window.addEventListener("focusin", onFocusIn, true);
  listeners.push(() => window.removeEventListener("focusin", onFocusIn, true));
  window.addEventListener("blur", onWindowBlur);
  listeners.push(() => window.removeEventListener("blur", onWindowBlur));

  // any mode change restores the chrome instantly (no timeout lag): clear the
  // latch for that moment, let the next keystroke re-arm
  const unsubscribeMode = mode.subscribe(() => {
    quiet = true;
    recompute();
  });
  listeners.push(unsubscribeMode);

  return () => {
    if (!started) return;
    started = false;
    editorFocused = false;
    quiet = false;
    uninstallMouseMove();
    dimActive = false;
    focusDim.set(false);
    for (const off of listeners) off();
    listeners.length = 0;
  };
}
