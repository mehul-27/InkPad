// Generic document model (spec §22). V1 types: Markdown and plain text.
// Adding a future format = one entry in languageFor + capabilitiesFor.

export type Language = "markdown" | "plaintext";

export interface Capabilities {
  canEdit: boolean;
  canRender: boolean;
  canSyntaxHighlight: boolean;
  canSave: boolean;
  canCopySource: boolean;
}

export interface Document {
  path: string;
  filename: string;
  extension: string;
  content: string;
  language: Language;
  dirty: boolean;
  capabilities: Capabilities;
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

export function capabilitiesFor(language: Language): Capabilities {
  switch (language) {
    case "markdown":
      return {
        canEdit: true,
        canRender: true,
        canSyntaxHighlight: true,
        canSave: true,
        canCopySource: true,
      };
    case "plaintext":
      return {
        canEdit: true,
        canRender: false,
        canSyntaxHighlight: false,
        canSave: true,
        canCopySource: true,
      };
  }
}

export function createDocument(path: string, content: string): Document {
  const language = languageFor(path) ?? "plaintext";
  return {
    path,
    filename: filenameOf(path),
    extension: extensionOf(path),
    content,
    language,
    dirty: false,
    capabilities: capabilitiesFor(language),
  };
}
