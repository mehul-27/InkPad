// Native position-preservation verification for InkPad (Phase 6 regression).
// Drives the REAL built Tauri app over the WebView2 DevTools protocol (CDP):
//   - launches src-tauri/target/release/inkpad.exe with the long test doc
//     (WebView2 remote debugging must be enabled via env var by the caller)
//   - sets the Reader's scroll to a target fraction
//   - switches modes by clicking the toolbar buttons
//   - reads the *logical* anchor line at each pane's 25% viewport anchor and
//     asserts it stayed at the same source location
// Usage: node scripts/verify-position.mjs
// No npm dependencies: Node >= 22 (global fetch + WebSocket).

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 9333;
const EXE = "src-tauri/target/release/inkpad.exe";
const DOC = "C:\\Users\\mehul\\AppData\\Local\\Temp\\opencode\\inkpad-long-doc.md";
const ANCHOR_FRAC = 0.25;
const TOLERANCE = 18; // lines: reader/editor layouts legitimately differ a little

const results = [];
let fails = 0;

function report(label, a, b, ok) {
  results.push({ label, a, b, ok });
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label.padEnd(46)} ${String(a).padStart(6)} -> ${String(b).padStart(6)}`);
}

// ---- CDP plumbing ----------------------------------------------------------

// Launch the app FIRST: the debug endpoint only exists while it runs.
console.log("Launching InkPad with the long document...");
const child = spawn(EXE, [DOC], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
});

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const targets = await res.json();
        // the app page (WebView2 starts on about:blank before navigating)
        const page = targets.find((t) => t.type === "page" && t.url.includes("tauri.localhost"))
          ?? targets.find((t) => t.type === "page" && t.url !== "about:blank");
        if (page) return page;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error("WebView2 debug endpoint never appeared");
}

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 15000);
  });
}

ws = await (async () => {
  const target = await getTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return socket;
})();

async function evalJs(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

// ---- in-page helpers (injected once; the page may navigate on startup, so
// ---- re-injected lazily whenever window.__t is missing) --------------------

const HELPERS = `
window.__t = window.__t || {
  readingPane: () => document.querySelector('.reading-pane'),
  modeButtons: () => Array.from(document.querySelectorAll('.mode-switch button')),
  // logical anchor line (1-based source line) at the reader's 25% viewport anchor
  readerAnchorLine: () => {
    const pane = document.querySelector('.reading-pane');
    if (!pane) return null;
    const els = Array.from(pane.querySelectorAll('.reading-column [data-source-line]'));
    if (!els.length) return -1;
    const rect = pane.getBoundingClientRect();
    const y = pane.scrollTop + pane.clientHeight * 0.25;
    let best = null;
    for (const el of els) {
      const top = el.getBoundingClientRect().top - rect.top + pane.scrollTop;
      if (top <= y) best = { start: Number(el.dataset.sourceLine), top };
      else break;
    }
    if (!best) return Number(els[0].dataset.sourceLine);
    return best.start;
  },
  // logical anchor line at the editor's 25% viewport anchor (from the line-number gutter)
  editorAnchorLine: () => {
    const scroller = document.querySelector('.cm-scroller');
    if (!scroller) return null;
    const gutter = document.querySelector('.cm-gutters');
    if (!gutter) return null;
    const rect = scroller.getBoundingClientRect();
    const y = scroller.scrollTop + scroller.clientHeight * 0.25;
    const el = Array.from(gutter.querySelectorAll('.cm-gutterElement'))
      .filter((g) => g.textContent.trim() !== '')
      .sort((a, b) => {
        const ra = a.getBoundingClientRect().top - rect.top + scroller.scrollTop;
        const rb = b.getBoundingClientRect().top - rect.top + scroller.scrollTop;
        return Math.abs(ra - y) - Math.abs(rb - y);
      })[0];
    return el ? parseInt(el.textContent.trim(), 10) : null;
  },
  readerScrollTo: (frac) => {
    const pane = document.querySelector('.reading-pane');
    if (!pane) return false;
    pane.scrollTop = frac * (pane.scrollHeight - pane.clientHeight);
    return true;
  },
  editorScrollTo: (frac) => {
    const scroller = document.querySelector('.cm-scroller');
    if (!scroller) return false;
    scroller.scrollTop = frac * (scroller.scrollHeight - scroller.clientHeight);
    return true;
  },
  clickMode: (label) => {
    const btn = Array.from(document.querySelectorAll('.mode-switch button')).find((b) => b.textContent.trim() === label);
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  },
  mode: () => {
    const r = document.querySelector('.reading-pane');
    const e = document.querySelector('.cm-editor');
    return r && e ? 'split' : r ? 'reading' : e ? 'edit' : 'none';
  },
  inEditor: () => !!document.querySelector('.cm-editor'),
  inReader: () => !!document.querySelector('.reading-pane'),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};
true;
`;

async function ensureHelpers() {
  let ok = false;
  try {
    ok = await evalJs("!!window.__t");
  } catch {}
  if (!ok) await evalJs(HELPERS);
}

// ---- settle: wait until a pane exists and its anchor line is stable -------

async function settle(readFn) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    let v = null;
    await ensureHelpers();
    try {
      v = await evalJs(readFn);
    } catch {}
    if (v !== null && v !== undefined) {
      if (v === last) return v;
      last = v;
    }
    try {
      await evalJs("window.__t.wait(100)");
    } catch {
      await sleep(100);
    }
  }
  return last;
}

// ---- launch the app --------------------------------------------------------

try {
  // wait for the reader to be up
  const readerReady = await settle("window.__t.inReader()");
  if (!readerReady) throw new Error("Reader never appeared");

  // ---- Reading -> Edit matrix ----
  console.log("\n== Reading -> Edit ==");
  for (const frac of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    await evalJs(`window.__t.readerScrollTo(${frac})`);
    await evalJs("window.__t.wait(120)");
    const before = await evalJs("window.__t.readerAnchorLine()");
    const ok = await evalJs("window.__t.clickMode('Edit')");
    if (!ok) throw new Error("Edit button not clickable");
    const after = await settle("window.__t.editorAnchorLine()");
    report(`R@${Math.round(frac * 100)}% -> E`, before, after, Math.abs(before - after) <= TOLERANCE);
    // back to reading for the next case
    await evalJs("window.__t.clickMode('Reading')");
    await settle("window.__t.readerAnchorLine()");
  }

  // ---- Edit -> Reading matrix ----
  console.log("\n== Edit -> Reading ==");
  await evalJs("window.__t.clickMode('Edit')");
  await settle("window.__t.editorAnchorLine()");
  for (const frac of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    await evalJs(`window.__t.editorScrollTo(${frac})`);
    await evalJs("window.__t.wait(120)");
    const before = await evalJs("window.__t.editorAnchorLine()");
    const ok = await evalJs("window.__t.clickMode('Reading')");
    if (!ok) throw new Error("Reading button not clickable");
    const after = await settle("window.__t.readerAnchorLine()");
    report(`E@${Math.round(frac * 100)}% -> R`, before, after, Math.abs(before - after) <= TOLERANCE);
    // back to edit for the next case
    await evalJs("window.__t.clickMode('Edit')");
    await settle("window.__t.editorAnchorLine()");
  }

  // ---- round trips (no re-scrolling between switches) ----
  console.log("\n== Round trips ==");
  {
    // R -> E -> R at 50%
    await evalJs("window.__t.clickMode('Reading')");
    await settle("window.__t.readerAnchorLine()");
    await evalJs("window.__t.readerScrollTo(0.5)");
    await evalJs("window.__t.wait(120)");
    const r0 = await evalJs("window.__t.readerAnchorLine()");
    await evalJs("window.__t.clickMode('Edit')");
    await settle("window.__t.editorAnchorLine()");
    await evalJs("window.__t.clickMode('Reading')");
    const r1 = await settle("window.__t.readerAnchorLine()");
    report("R@50 -> E -> R", r0, r1, Math.abs(r0 - r1) <= TOLERANCE);

    // E -> R -> E at 75%
    await evalJs("window.__t.clickMode('Edit')");
    await settle("window.__t.editorAnchorLine()");
    await evalJs("window.__t.editorScrollTo(0.75)");
    await evalJs("window.__t.wait(120)");
    const e0 = await evalJs("window.__t.editorAnchorLine()");
    await evalJs("window.__t.clickMode('Reading')");
    await settle("window.__t.readerAnchorLine()");
    await evalJs("window.__t.clickMode('Edit')");
    const e1 = await settle("window.__t.editorAnchorLine()");
    report("E@75 -> R -> E", e0, e1, Math.abs(e0 - e1) <= TOLERANCE);
  }

  // ---- summary ----
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  if (fails) {
    console.error("POSITION VERIFICATION FAILED");
    process.exitCode = 1;
  } else {
    console.log("POSITION VERIFICATION PASSED");
  }
} finally {
  ws.close();
  child.kill();
}
