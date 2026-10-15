<script lang="ts">
  // Phase 4: CodeMirror 6 editor. The `doc` store is the single source of
  // truth: every edit pushes new content into the store (markDocumentDirty
  // schedules the debounced autosave), and external content changes flow
  // back into the editor. The editor is rebuilt per document (fresh undo
  // history, detected line endings).
  //
  // Perf (Fix D): a fresh view is created ONLY when the document changes.
  // Reading ↔ Edit ↔ Split keep this component mounted (DocumentPane merely
  // toggles pane visibility through the `visible` prop), so the mode switch
  // no longer rebuilds the EditorState — the doc, selection, scroll and undo
  // history all survive. On a mode change the shared viewport anchor is
  // re-adopted from the position map, exactly what the old fresh mount did.
  import { Compartment, EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
  import { onDestroy } from "svelte";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { search, searchKeymap, openSearchPanel, SearchQuery } from "@codemirror/search";
  import { ViewPlugin, ViewUpdate } from "@codemirror/view";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { doc, editorCommand, mode, type Mode } from "../stores";
  import { markDocumentDirty } from "../actions";
  import { armFocusDim } from "../focusDim";
  import { languageFor } from "../languages";
  import type { Document } from "../docs";
  import { get } from "svelte/store";
  import { settings } from "../settings";
  import {
    rememberPosition,
    takePosition,
    VIEWPORT_ANCHOR_FRACTION,
    type PositionAnchor,
  } from "../position";

  // ---- syntax palette: restrained, mapped to theme tokens --------------

  // Fix D: visibility of the hosting pane. DocumentPane keeps this component
  // mounted across mode switches and only toggles the pane's display:none;
  // the view, its scroll offset and selection live on untouched.
  let { visible = true }: { visible?: boolean } = $props();

  const syntaxStyle = HighlightStyle.define([
    { tag: t.heading, color: "var(--prose-heading)", fontWeight: "650" },
    { tag: t.strong, color: "var(--prose-heading)", fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through", color: "var(--syntax-comment)" },
    { tag: t.link, color: "var(--accent)" },
    { tag: t.url, color: "var(--accent)" },
    { tag: t.monospace, background: "var(--surface-raised)" },
    { tag: t.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
    { tag: t.keyword, color: "var(--syntax-keyword)" },
    { tag: t.string, color: "var(--syntax-string)" },
    { tag: t.number, color: "var(--syntax-number)" },
    { tag: t.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
    { tag: t.function(t.variableName), color: "var(--syntax-function)" },
    { tag: t.propertyName, color: "var(--syntax-function)" },
    { tag: t.list, color: "var(--muted-foreground)" },
  ]);

  const editorTheme = EditorView.theme(
    {
      "&": {
        height: "100%",
        // live font size comes from Settings via a CSS variable on the root
        backgroundColor: "var(--code-background)",
        fontSize: "var(--inkpad-editor-font-size, 14px)",
      },
      ".cm-scroller": {
        fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace',
        lineHeight: "1.7",
        overflow: "auto",
      },
      ".cm-content": { padding: "12px 0", caretColor: "var(--accent)" },
      ".cm-line": { padding: "0 24px" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
      "&.cm-focused": { outline: "none" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        background: "var(--accent-soft)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--code-background)",
        color: "var(--muted-foreground)",
        border: "none",
        userSelect: "none",
      },
      ".cm-activeLineGutter": { backgroundColor: "var(--surface)" },
      ".cm-panels": {
        backgroundColor: "var(--surface)",
        color: "var(--foreground)",
        borderBottom: "1px solid var(--hairline)",
      },
      ".cm-panel.cm-search": {
        padding: "6px 10px",
        fontFamily: '"IBM Plex Sans Variable", "IBM Plex Sans", sans-serif',
        fontSize: "12.5px",
      },
      ".cm-panel.cm-search input": {
        background: "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "5px",
        padding: "3px 7px",
        fontSize: "12.5px",
      },
      ".cm-panel.cm-search button": {
        background: "var(--surface-raised)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "5px",
        padding: "3px 8px",
        fontSize: "12px",
        cursor: "pointer",
      },
      ".cm-panel.cm-search button:hover": { background: "var(--popover)" },
      ".cm-search-counter": {
        color: "var(--muted-foreground)",
        fontSize: "12px",
        margin: "0 4px 0 8px",
        whiteSpace: "nowrap",
      },
      ".cm-searchMatch": {
        backgroundColor: "var(--accent-soft)",
        outline: "1px solid var(--border)",
      },
      ".cm-searchMatch-selected": {
        backgroundColor: "var(--accent)",
        outline: "1px solid var(--accent)",
      },
    },
    { dark: true },
  );

  // ---- search match counter: CM's panel has no built-in "N of M" -------

  const matchCounter = ViewPlugin.fromClass(
    class {
      private span: HTMLSpanElement;
      private view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        this.span = document.createElement("span");
        this.span.className = "cm-search-counter";
        this.span.textContent = "";
      }
      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet && !update.transactions.some((t) => t.effects.length)) return;
        const panel = this.view.dom.querySelector(".cm-panel.cm-search");
        if (!panel) return;
        if (!this.span.isConnected) {
          const input = panel.querySelector('input[name="search"]');
          if (input?.nextSibling && input.parentElement) input.parentElement.insertBefore(this.span, input.nextSibling);
          else panel.appendChild(this.span);
        }
        const field = panel.querySelector<HTMLInputElement>('input[name="search"]');
        if (!field || !field.value) {
          this.span.textContent = "";
          return;
        }
        const caseSensitive = (panel.querySelector('input[name="case"]') as HTMLInputElement)?.checked ?? false;
        const regexp = (panel.querySelector('input[name="re"]') as HTMLInputElement)?.checked ?? false;
        const wholeWord = (panel.querySelector('input[name="word"]') as HTMLInputElement)?.checked ?? false;
        const query = new SearchQuery({ search: field.value, caseSensitive, regexp, wholeWord });
        let total = 0;
        let current = 0;
        const pos = this.view.state.selection.main.from;
        const cursor = query.getCursor(this.view.state.doc);
        let res = cursor.next();
        while (!res.done) {
          total++;
          if (!current && res.value.to > pos) current = total;
          res = cursor.next();
        }
        this.span.textContent = total ? `${current || 1} of ${total}` : "0 matches";
      }
    },
  );

  // ---- editor instance --------------------------------------------------

  let view: EditorView | undefined;
  let container: HTMLDivElement;
  // Perf (Fix C): the document language loads on demand and attaches via this
  // compartment (see createView). One token is shared by every view: a
  // reconfigure reaches the live view it belongs to.
  const languageCompartment = new Compartment();
  // Perf (Fix D): word wrap is swapped through this compartment instead of
  // destroying and recreating the view — state (doc, selection, undo history)
  // survives the Settings toggle exactly as a mode switch keeps it now.
  const wrapCompartment = new Compartment();
  let viewKey: string | undefined;
  let applyingExternal = false;
  let lastWrap = true;
  // Scroll requested before CodeMirror's first measure: applied from the
  // updateListener once geometry is real (see createView).
  let pendingScroll: { pos: number } | null = null;

  // Phase 6 position preservation: the viewport anchor (25% from the top) is
  // a source line — captured while the editor is live, restored so the same
  // line lands back at the same viewport fraction. Positions are remembered
  // continuously while mounted; teardown never captures (a detached view has
  // no geometry). The Reader's anchor is consulted through the same shared
  // map, so Reading → Edit hands over the reading location.
  function captureAnchor(v: EditorView): PositionAnchor {
    const state = v.state;
    const scroller = v.scrollDOM;
    let line = 1;
    try {
      const anchorY = scroller.scrollTop + scroller.clientHeight * VIEWPORT_ANCHOR_FRACTION;
      const block = v.lineBlockAtHeight(anchorY);
      line = state.doc.lineAt(Math.min(block.from, state.doc.length)).number;
    } catch {
      // view mid-teardown or not yet measured: fall back to the cursor
      line = state.doc.lineAt(state.selection.main.head).number;
    }
    const cursorLine = state.doc.lineAt(state.selection.main.head).number;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const frac = maxScroll > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / maxScroll)) : 0;
    return { line, frac, cursorLine };
  }

  function applyAnchor(v: EditorView, anchor: PositionAnchor | null): void {
    if (!anchor) return;
    const state = v.state;
    let line = anchor.line;
    if (line < 1) line = Math.round(anchor.frac * state.doc.lines); // fraction-only anchor
    line = Math.min(Math.max(line, 1), state.doc.lines);
    const pos = state.doc.line(line).from;
    const cursorLine = anchor.cursorLine != null ? Math.min(Math.max(anchor.cursorLine, 1), state.doc.lines) : line;
    v.dispatch({ selection: { anchor: state.doc.line(cursorLine).from } });
    pendingScroll = { pos };
  }

  function lineSeparatorFor(text: string): string | undefined {
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
    return crlf > lf ? "\r\n" : undefined;
  }

  function createView(current: Document, wordWrap: boolean): EditorView {
    const separator = lineSeparatorFor(current.content);
    const created = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: current.content,
        extensions: [
          ...(separator ? [EditorState.lineSeparator.of(separator)] : []),
          lineNumbers(),
          wordWrap ? EditorView.lineWrapping : [],
          history(),
          drawSelection(),
          editorTheme,
          syntaxHighlighting(syntaxStyle),
          // Perf (Fix C): language packs load on demand. The view starts
          // with an empty language compartment — identical to the plain-text
          // editor, zero typing lag on a cold type — and the current
          // document's language attaches the moment its deferred chunk
          // resolves (prewarmed from document activation, usually ready
          // before the first keystroke). A failed pack load resolves to a
          // plain-text extension, so the editor can never crash on it.
          languageCompartment.of([]),
          wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
          search({ top: true }),
          matchCounter,
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            // §25: Ctrl+H = find & replace. This @codemirror/search version
            // ships no openReplacePanel export and no panel toggle — the
            // replace field is always in the panel, so opening it and
            // focusing the replace input is the faithful behavior.
            { key: "Mod-h", run: openSearchPanel },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.geometryChanged && pendingScroll) {
              // a deferred anchor restore only runs while the pane is shown:
              // a display:none scroller cannot take a scroll offset, so the
              // pending anchor is kept until the pane becomes visible and
              // CodeMirror measures again (see the show-restore effect below)
              if (!visible) return;
              // first measure complete: line heights and viewport size are
              // real, so the anchor line can be placed at the viewport
              // fraction (25% from the top) with exact geometry
              const p = pendingScroll;
              pendingScroll = null;
              try {
                const scroller = u.view.scrollDOM;
                const block = u.view.lineBlockAt(p.pos);
                const maxScroll = scroller.scrollHeight - scroller.clientHeight;
                scroller.scrollTop = Math.min(
                  Math.max(block.top - scroller.clientHeight * VIEWPORT_ANCHOR_FRACTION, 0),
                  maxScroll,
                );
              } catch {
                // geometry not yet usable; the user's next interaction resets scroll
              }
            }
            if (u.docChanged && !applyingExternal) {
              markDocumentDirty(u.state.doc.toString());
              // focus dim: a real keystroke re-engages the chrome fade (it is
              // latched off by mouse movement); no state work while the dim
              // store is already true and the mouse is untouched
              armFocusDim();
            }
          }),
          EditorView.contentAttributes.of({ spellcheck: "false" }),
        ],
      }),
    });
    // attach the document's language when its dynamic chunk resolves; skip
    // if the document switched or the view was rebuilt meanwhile (the fresh
    // view starts its own load)
    const docId = current.id;
    void languageFor(current.format.editorLanguage).then((ext) => {
      if (view !== created || viewKey !== docId) return;
      view.dispatch({ effects: languageCompartment.reconfigure(ext) });
    });
    return created;
  }

  // Recreate per document (fresh history + line endings); otherwise mirror
  // authoritative store content into the editor when it changes externally.
  // Positions are remembered continuously (scroll) and restored when a
  // previously visited path mounts again. Fix D: mode switches no longer
  // reach this effect at all — the view persists and only its pane's
  // visibility changes.
  $effect(() => {
    const current = $doc;
    if (!current) return;
    if (!view || viewKey !== current.id) {
      if (view) view.destroy();
      viewKey = current.id;
      lastWrap = get(settings).wordWrap;
      view = createView(current, lastWrap);
      // a fresh document invalidates any exact scroll offset saved for the
      // previous one (see the show-restore effect)
      savedScrollTop = null;
      applyAnchor(view, takePosition(current.id));
      // The editor is the writing surface for every format (and the only
      // surface for non-Markdown), so a freshly mounted document — a new
      // document in particular — should be ready to type in. CodeMirror's
      // focus() uses preventScroll, so the restored position is not disturbed.
      view.focus();
      return;
    }
    const editorText = view.state.doc.toString();
    if (editorText === current.content) return;
    applyingExternal = true;
    view.dispatch({
      changes: { from: 0, to: editorText.length, insert: current.content },
    });
    applyingExternal = false;
  });

  // Continuous position capture while mounted: the view is live here, so
  // scroll geometry is real. Keeps the per-path anchor fresh for any later
  // mode switch, document switch, or close. Capture fires on scroll only —
  // the restore's deferred scroll itself fires one, so the first capture
  // always reflects the restored position, never the pre-restore scroll 0.
  let scrollRaf = 0;
  $effect(() => {
    const v = view;
    const key = $doc?.id;
    if (!v || !key) return;
    const scroller = v.scrollDOM;
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        // a hidden pane (Fix D) reports no live geometry — capturing would
        // stamp a bogus anchor; the rAF may fire across a just-toggled hide
        if (!visible || !scroller.isConnected || pendingScroll) return;
        rememberPosition(key, captureAnchor(v));
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    };
  });

  // Word wrap (Settings) is a view-level extension choice. Fix D: it is
  // swapped through a Compartment instead of rebuilding the EditorState — the
  // doc, selection and undo history survive — and the logical viewport anchor
  // is re-applied afterwards, the same restore the old rebuild performed.
  // Font size needs no rebuild — it is a CSS variable.
  $effect(() => {
    const wantWrap = $settings.wordWrap;
    const current = $doc;
    if (!current || !view || viewKey !== current.id || wantWrap === lastWrap) return;
    lastWrap = wantWrap;
    const anchor = captureAnchor(view);
    view.dispatch({
      effects: wrapCompartment.reconfigure(wantWrap ? EditorView.lineWrapping : []),
    });
    applyAnchor(view, anchor);
    view.requestMeasure();
  });

  // ---- Fix D: persistence across mode switches ------------------------------
  // DocumentPane keeps this component mounted for every mode and toggles the
  // pane's display:none. CodeMirror cannot size or scroll inside a hidden
  // pane, so:
  //   - hiding snapshots the exact scroll offset (pre-DOM, geometry still
  //     real) and showing restores it byte-for-byte when no anchor is pending;
  //   - every mode change re-adopts the shared viewport anchor (the Reader's
  //     hand-off), exactly what the old pass-through remount did — with the
  //     pending-anchor mechanism placing the line at the 25% viewport anchor
  //     once CodeMirror measures the real layout.

  // Exact scroll offset of the current document while its pane is hidden.
  // Cleared on document switches (a fresh doc restores through the anchor).
  let savedScrollTop: number | null = null;

  $effect.pre(() => {
    if (!visible) {
      // snapshot while the pane still has real geometry: pre effects run
      // before Svelte applies the display:none class
      if (view) savedScrollTop = view.scrollDOM.scrollTop;
      return;
    }
  });

  $effect(() => {
    if (!visible) return;
    const v = view;
    if (!v) return;
    // a preserved offset only exists when the pane was hidden with no anchor
    // pending (a pending anchor wins — it is the more recent intent)
    if (pendingScroll === null && savedScrollTop !== null) {
      v.scrollDOM.scrollTop = savedScrollTop;
    }
    savedScrollTop = null;
    // nudge CodeMirror to re-measure the newly shown pane: its viewport went
    // 0-size while hidden, and the measure step applies any pending anchor
    // (both effects above use it) through the updateListener
    v.requestMeasure();
  });

  // Mode change: re-adopt the shared anchor (fresh-mount parity). Skipped
  // when the document changed in the same flush — the document-switch effect
  // above owns that restore.
  let prevAdoptDoc: string | null = null;
  let prevAdoptMode: Mode | null = null;
  $effect(() => {
    const m = $mode;
    const id = $doc?.id ?? null;
    const docChanged = prevAdoptDoc !== id;
    const modeChanged = prevAdoptMode !== null && prevAdoptMode !== m;
    prevAdoptDoc = id;
    prevAdoptMode = m;
    if (docChanged || modeChanged === false) return;
    const v = view;
    if (!v || id === null || viewKey !== id) return;
    // while the pane is hidden the anchor is kept pending (see the
    // updateListener guard) and applies on the next show + measure
    applyAnchor(v, takePosition(id));
    v.requestMeasure();
    // a fresh mount always focused the editor when it appeared in a mode
    // where it is visible; display:none focus attempts are no-ops, so this
    // stays inert while the pane is hidden
    if (visible) v.focus();
  });

  // Consume one-shot editor commands (search/replace from Ctrl+F/Ctrl+H
  // outside the editor, goto-line from the outline). Must run after the
  // view-creation effect so `view` exists when a command arrives while the
  // editor is mounting.
  $effect(() => {
    const command = $editorCommand;
    if (!command || !view) return;
    editorCommand.set(null);
    if (command.kind === "search") {
      openSearchPanel(view);
      return;
    }
    if (command.kind === "replace") {
      openSearchPanel(view);
      const v = view;
      queueMicrotask(() => {
        // the panel's DOM is attached synchronously with the dispatch above;
        // focus the replace field to distinguish Ctrl+H from Ctrl+F
        v.dom
          .querySelector<HTMLInputElement>(".cm-panel.cm-search input[name=replace]")
          ?.focus();
      });
      return;
    }
    const line = Math.min(Math.max(command.line, 1), view.state.doc.lines);
    const pos = view.state.doc.line(line).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  });
  // Unmount (document close / empty state): the editor must be fully
  // destroyed, otherwise the whole CM instance — DOM, syntax tree, and the
  // ResizeObserver that keeps it alive — stays in memory after the last
  // document is gone. Mode switches no longer unmount (Fix D), so this runs
  // only when the document disappears entirely.
  onDestroy(() => {
    if (view) {
      view.destroy();
      view = undefined;
    }
  });

  const fontPx = $derived(
    $settings.editorFontSize === "small"
      ? "12.5px"
      : $settings.editorFontSize === "large"
        ? "15.5px"
        : "14px",
  );
</script>

<div
  class="editor-root"
  style="--inkpad-editor-font-size: {fontPx}"
  bind:this={container}
></div>

<style>
  .editor-root {
    height: 100%;
    background: var(--code-background);
    overflow: hidden;
  }
</style>
