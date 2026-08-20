// Generic document model (spec §22). V1 types: Markdown and plain text.
// Adding a future format = one entry in languageFor.

export type Language = "markdown" | "plaintext";

export interface Document {
  path: string;
  filename: string;
  content: string;
  language: Language;
  dirty: boolean;
  /** Bundled welcome document: never autosaved, saves route to Save As. */
  welcome: boolean;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

export function filenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function extensionOf(path: string): string {
  const name = filenameOf(path);
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function languageFor(path: string): Language | null {
  const ext = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (ext === "txt") return "plaintext";
  return null;
}

export function isSupportedFile(path: string): boolean {
  return languageFor(path) !== null;
}

export function createDocument(path: string, content: string, welcome = false): Document {
  const language = languageFor(path) ?? "plaintext";
  return {
    path,
    filename: filenameOf(path),
    content,
    language,
    dirty: false,
    welcome,
  };
}
