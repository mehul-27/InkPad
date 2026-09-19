// Maps a format's stable editor-language id (docs.ts) to a CodeMirror 6
// language extension. Kept separate from the registry so docs.ts stays free
// of editor dependencies (it is imported by pure logic and tests).

import type { Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import type { EditorLanguageId } from "./docs";

/** Language support for an editor-language id; empty for plain text. */
export function editorLanguageExtension(id: EditorLanguageId): Extension {
  switch (id) {
    case "markdown":
      return markdown();
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ typescript: true, jsx: true });
    case "json":
      return json();
    case "python":
      return python();
    case "html":
      return html();
    case "css":
      return css();
    case "sql":
      return sql();
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    case "cpp":
      return cpp();
    case "java":
      return java();
    case "rust":
      return rust();
    case "go":
      return go();
    case "plaintext":
      return [];
  }
}
