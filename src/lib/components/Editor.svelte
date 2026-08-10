<script lang="ts">
  // Phase 4: CodeMirror 6 editor. The `doc` store is the single source of
  // truth: every edit pushes new content into the store (markDocumentDirty
  // schedules the debounced autosave), and external content changes flow
  // back into the editor. The editor is rebuilt per document (fresh undo
  // history, detected line endings).

  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { search, searchKeymap, openSearchPanel, SearchQuery } from "@codemirror/search";
  import { ViewPlugin, ViewUpdate } from "@codemirror/view";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { doc, editorCommand } from "../stores";
  import { markDocumentDirty } from "../actions";
  import { get } from "svelte/store";
  import { settings } from "../settings";
  import {
    rememberEditorPosition,
    takeEditorPosition,
    type PositionAnchor,
  } from "../position";

  // ---- syntax palette: restrained, mapped to theme tokens --------------

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
  let viewPath: string | undefined;
  let applyingExternal = false;
  let lastWrap = true;

  // Phase 6 position preservation: record where the user was (cursor line +
  // top visible line) when the editor goes away, and restore that location
  // when it comes back. Logical lines, not pixels — Reader and Editor have
  // different line heights (spec §"reading/edit position").
  function captureAnchor(v: EditorView): PositionAnchor {
    const state = v.state;
    const scroller = v.scrollDOM;
    let topLine = 1;
    try {
      const block = v.lineBlockAtHeight(scroller.scrollTop);
      topLine = state.doc.lineAt(Math.min(block.from, state.doc.length)).number;
    } catch {
      // view mid-teardown: fall back to the cursor
      topLine = state.doc.lineAt(state.selection.main.head).number;
    }
    const cursorLine = state.doc.lineAt(state.selection.main.head).number;
    return {
      line: topLine,
      frac: state.doc.lines > 0 ? topLine / state.doc.lines : 0,
      cursorLine,
    };
  }

  function applyAnchor(v: EditorView, anchor: PositionAnchor | null): void {
    if (!anchor) return;
    const state = v.state;
    const line = Math.min(anchor.line, state.doc.lines);
    if (line < 1) return;
    const scrollPos = state.doc.line(line).from;
    const cursorLine = anchor.cursorLine != null ? Math.min(Math.max(anchor.cursorLine, 1), state.doc.lines) : null;
    const effects = [EditorView.scrollIntoView(scrollPos, { y: "start" })];
    if (cursorLine != null) {
      v.dispatch({ selection: { anchor: state.doc.line(cursorLine).from }, effects });
    } else {
      v.dispatch({ effects });
    }
  }

  function lineSeparatorFor(text: string): string | undefined {
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
    return crlf > lf ? "\r\n" : undefined;
  }

  function createView(current: { path: string; content: string; language: string }, wordWrap: boolean): EditorView {
    const languageExt = current.language === "markdown" ? markdown() : [];
    const separator = lineSeparatorFor(current.content);
    const view = new EditorView({
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
          languageExt,
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
            if (u.docChanged && !applyingExternal) {
              markDocumentDirty(u.state.doc.toString());
            }
          }),
          EditorView.contentAttributes.of({ spellcheck: "false" }),
        ],
      }),
    });
    return view;
  }

  // Recreate per document (fresh history + line endings); otherwise mirror
  // authoritative store content into the editor when it changes externally.
  // Positions are remembered when an old editor is torn down and restored
  // when a new one (for a previously visited path) mounts.
  $effect(() => {
    const current = $doc;
    if (!current) return;
    if (!view || viewPath !== current.path) {
      if (view) {
        try {
          rememberEditorPosition(viewPath ?? "", captureAnchor(view));
        } catch {
          // view already tearing down; this visit's anchor is lost
        }
        view.destroy();
      }
      viewPath = current.path;
      lastWrap = get(settings).wordWrap;
      view = createView(current, lastWrap);
      applyAnchor(view, takeEditorPosition(current.path));
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

  // Remember the position whenever this editor goes away (mode switch, split
  // close, document switch, app teardown). `$doc` keeps the effect in sync
  // with document changes; the cleanup always captures the view that was
  // live when the effect last ran.
  $effect(() => {
    $doc;
    const path = $doc?.path;
    const v = view;
    return () => {
      if (!path || !v) return;
      try {
        rememberEditorPosition(path, captureAnchor(v));
      } catch {
        // view destroyed by the document effect; nothing to capture
      }
    };
  });

  // Word wrap (Settings) is a view-level extension choice: applying it live
  // recreates the editor, preserving scroll and cursor via the same anchor
  // mechanism. Font size needs no rebuild — it is a CSS variable.
  $effect(() => {
    const wantWrap = $settings.wordWrap;
    const current = $doc;
    if (!current || !view || viewPath !== current.path || wantWrap === lastWrap) return;
    lastWrap = wantWrap;
    const anchor = captureAnchor(view);
    view.destroy();
    view = createView(current, wantWrap);
    applyAnchor(view, anchor);
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
