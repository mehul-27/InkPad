// Maps a format's stable editor-language id (docs.ts) to a CodeMirror 6
// language extension. Kept separate from the registry so docs.ts stays free
// of editor dependencies (it is imported by pure logic and tests).
//
// Perf (Fix C): all 14 @codemirror/lang-* packages used to be statically
// imported here and parsed before the first paint (~one third of the whole
// bundle). Each id now loads on demand through a dynamic import() — one
// deferred chunk per package — deduped through a per-id promise cache. The
// editor prewarms only the current document's language (zero lag on a cold
// type); all other packs stay unloaded until their format is actually
// edited. A pack that fails to load resolves to a plain-text extension so
// the editor can never crash on it.

import type { Extension } from "@codemirror/state";
import type { EditorLanguageId } from "./docs";

type Loader = () => Promise<Extension>;

const loaders: Record<EditorLanguageId, Loader> = {
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  javascript: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  typescript: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true, jsx: true }),
    ),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  plaintext: () => Promise.resolve([]),
};

const cache = new Map<EditorLanguageId, Promise<Extension>>();

/** Language support for an editor-language id, loaded on demand. Concurrent
 *  callers share one in-flight dynamic import (the in-module cache maps the
 *  id → the language module promise). A failed load is dropped from the
 *  cache (so a later request can retry) and resolves to an empty plain-text
 *  extension — the editor must never crash on a language pack. */
export function languageFor(id: EditorLanguageId): Promise<Extension> {
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = loaders[id]().catch((): Extension => {
    cache.delete(id);
    return [];
  });
  cache.set(id, promise);
  return promise;
}

/** Fire-and-forget prewarm of a document's editor language (Fix C): starts
 *  the dynamic load without touching the editor state. */
export function prewarmEditorLanguage(id: EditorLanguageId): void {
  void languageFor(id);
}
