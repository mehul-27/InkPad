// Centralized document-format registry (spec §22). Every question about file
// types — which extensions are supported, how a file is read, which editor
// language it uses, whether Reading/Split mode applies, what the native
// dialogs should offer, and what a brand-new document is called — is answered
// here. Adding a future format is one entry in DOCUMENT_FORMATS plus (if it
// needs syntax highlighting) one case in languages.ts.

/** Broad grouping used for the native file-dialog filters. */
export type FormatCategory = "markdown" | "text" | "code" | "data" | "config" | "web";

/** Which reader view (if any) can render a format. */
export type ReaderKind = "markdown" | "none";

/**
 * Stable identifier for the CodeMirror language a format is edited with.
 * Resolved to an actual CodeMirror extension in languages.ts, so this module
 * stays free of editor dependencies.
 */
export type EditorLanguageId =
  | "markdown"
  | "plaintext"
  | "json"
  | "javascript"
  | "typescript"
  | "python"
  | "html"
  | "css"
  | "sql"
  | "xml"
  | "yaml"
  | "cpp"
  | "java"
  | "rust"
  | "go";

export interface DocumentFormat {
  /** Stable identifier, also used as the value in the New Document dialog. */
  id: string;
  /** Human-readable name shown in menus and dialogs. */
  label: string;
  /** Lowercase extensions without a leading dot; the first is the default. */
  extensions: string[];
  category: FormatCategory;
  /** Native-dialog filter group this format belongs to. */
  group: string;
  /** Whether the format can be edited (all current formats can). */
  editable: boolean;
  /** Reader implementation, or "none" for editor-only formats. */
  reader: ReaderKind;
  /** Whether the split (editor + reader) view applies. */
  splitSupported: boolean;
  /** Editor language; "plaintext" for formats without syntax highlighting. */
  editorLanguage: EditorLanguageId;
}

// Group labels are used verbatim as native-dialog filter names and as the
// optgroup headings in the New Document dialog. Order here is the order the
// filters appear in the Open dialog.
const GROUP_MARKDOWN = "Markdown";
const GROUP_TEXT = "Text";
const GROUP_WEB = "Web";
const GROUP_JAVASCRIPT = "JavaScript";
const GROUP_TYPESCRIPT = "TypeScript";
const GROUP_PYTHON = "Python";
const GROUP_CPP = "C/C++";
const GROUP_DATA = "Data";
const GROUP_JAVA = "Java";
const GROUP_RUST = "Rust";
const GROUP_GO = "Go";
const GROUP_SQL = "SQL";

function textFormat(
  id: string,
  label: string,
  extensions: string[],
  group = GROUP_TEXT,
): DocumentFormat {
  return {
    id,
    label,
    extensions,
    category: "text",
    group,
    editable: true,
    reader: "none",
    splitSupported: false,
    editorLanguage: "plaintext",
  };
}

function codeFormat(
  id: string,
  label: string,
  extensions: string[],
  group: string,
  editorLanguage: EditorLanguageId,
  category: FormatCategory = "code",
): DocumentFormat {
  return {
    id,
    label,
    extensions,
    category,
    group,
    editable: true,
    reader: "none",
    splitSupported: false,
    editorLanguage,
  };
}

/** The single source of truth for every supported text format. */
export const DOCUMENT_FORMATS: readonly DocumentFormat[] = [
  {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown"],
    category: "markdown",
    group: GROUP_MARKDOWN,
    editable: true,
    reader: "markdown",
    splitSupported: true,
    editorLanguage: "markdown",
  },
  textFormat("plaintext", "Plain Text", ["txt"]),
  textFormat("log", "Log", ["log"]),
  textFormat("ini", "INI / Config", ["ini", "conf", "env"]),
  codeFormat("html", "HTML", ["html", "htm"], GROUP_WEB, "html", "web"),
  codeFormat("css", "CSS", ["css"], GROUP_WEB, "css", "web"),
  codeFormat("javascript", "JavaScript", ["js", "mjs", "cjs", "jsx"], GROUP_JAVASCRIPT, "javascript"),
  codeFormat("typescript", "TypeScript", ["ts", "tsx"], GROUP_TYPESCRIPT, "typescript"),
  codeFormat("python", "Python", ["py"], GROUP_PYTHON, "python"),
  codeFormat("cpp", "C / C++", ["c", "h", "cpp", "hpp"], GROUP_CPP, "cpp"),
  codeFormat("json", "JSON", ["json"], GROUP_DATA, "json", "data"),
  codeFormat("yaml", "YAML", ["yaml", "yml"], GROUP_DATA, "yaml", "data"),
  codeFormat("toml", "TOML", ["toml"], GROUP_DATA, "plaintext", "config"),
  codeFormat("xml", "XML", ["xml"], GROUP_DATA, "xml", "data"),
  codeFormat("csv", "CSV", ["csv"], GROUP_DATA, "plaintext", "data"),
  codeFormat("java", "Java", ["java"], GROUP_JAVA, "java"),
  codeFormat("rust", "Rust", ["rs"], GROUP_RUST, "rust"),
  codeFormat("go", "Go", ["go"], GROUP_GO, "go"),
  codeFormat("sql", "SQL", ["sql"], GROUP_SQL, "sql"),
];

export const DEFAULT_FORMAT: DocumentFormat = DOCUMENT_FORMATS[0];

/** The default extension (also the one a new document is named with). */
export function defaultExtension(format: DocumentFormat): string {
  return format.extensions[0] ?? "";
}

/** Default name for a brand-new, never-saved document of this format. */
export function defaultFilename(format: DocumentFormat): string {
  return `Untitled.${defaultExtension(format)}`;
}

export function formatById(id: string): DocumentFormat | undefined {
  return DOCUMENT_FORMATS.find((f) => f.id === id);
}

export function formatForExtension(extension: string): DocumentFormat | undefined {
  const ext = extension.toLowerCase().replace(/^\./, "");
  if (!ext) return undefined;
  return DOCUMENT_FORMATS.find((f) => f.extensions.includes(ext));
}

export function formatForPath(path: string): DocumentFormat | undefined {
  return formatForExtension(extensionOf(path));
}

export function isSupportedFile(path: string): boolean {
  return formatForPath(path) !== undefined;
}

// ---- document model --------------------------------------------------------

let nextDocumentId = 1;

export interface Document {
  /** Session-unique identity, used for editor rebuilds and position memory. */
  id: string;
  /** Filesystem path; null for a new document that has never been saved. */
  path: string | null;
  /** Display name (the basename), always present — "Untitled.md" when new. */
  filename: string;
  content: string;
  format: DocumentFormat;
  dirty: boolean;
  /** Bundled welcome document: never autosaved, saves route to Save As. */
  welcome: boolean;
}

function newDocumentId(): string {
  return `doc-${nextDocumentId++}`;
}

export function filenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function extensionOf(nameOrPath: string): string {
  const name = filenameOf(nameOrPath);
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Name without its final extension; hidden files like ".env" are kept. */
export function baseNameOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}

/** Build a document that exists on disk. */
export function createDocument(path: string, content: string, welcome = false): Document {
  return {
    id: newDocumentId(),
    path,
    filename: filenameOf(path),
    content,
    format: formatForPath(path) ?? DEFAULT_FORMAT,
    dirty: false,
    welcome,
  };
}

/** Build an in-memory document that has never been saved (no temp file). */
export function createUntitledDocument(format: DocumentFormat, filename?: string): Document {
  const name = filename?.trim() || defaultFilename(format);
  return {
    id: newDocumentId(),
    path: null,
    filename: name,
    content: "",
    format,
    dirty: false,
    welcome: false,
  };
}

// ---- native dialog filters -------------------------------------------------

export interface DialogFilter {
  name: string;
  extensions: string[];
}

/** Filter groups in registry order, each with the union of its extensions. */
export function formatFilterGroups(): DialogFilter[] {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const format of DOCUMENT_FORMATS) {
    if (!map.has(format.group)) {
      map.set(format.group, []);
      order.push(format.group);
    }
    map.get(format.group)!.push(...format.extensions);
  }
  return order.map((name) => ({ name, extensions: map.get(name)! }));
}

function allSupportedExtensions(): string[] {
  return DOCUMENT_FORMATS.flatMap((f) => f.extensions);
}

/** Open dialog: "All Supported Files" first, then each group, then All Files. */
export function openDialogFilters(): DialogFilter[] {
  return [
    { name: "All Supported Files", extensions: allSupportedExtensions() },
    ...formatFilterGroups(),
    { name: "All Files", extensions: ["*"] },
  ];
}

/**
 * Save dialog filters. The document's own format comes first so the native
 * "Save as type" dropdown opens on it (and Windows takes its *default
 * extension* from the first filter's first extension, so a name typed without
 * one still gets the right suffix). The per-group filters follow, then
 * "All Supported Files", then "All Files".
 *
 * Note the Windows dialog appends the default extension when the typed
 * extension is not part of the selected filter — so saving a Markdown
 * document as "notes.txt" means picking the Text filter (or "All Supported
 * Files") first. Selecting the document's own format by default is the
 * expected behavior; the cost of the alternative (a first filter that
 * accepted everything) was that the dropdown never showed the real format.
 */
export function saveDialogFilters(format: DocumentFormat): DialogFilter[] {
  const specific: DialogFilter = { name: format.label, extensions: format.extensions };
  const groups = formatFilterGroups().filter(
    (group) =>
      group.name !== specific.name ||
      group.extensions.join(",") !== specific.extensions.join(","),
  );
  return [
    specific,
    ...groups,
    { name: "All Supported Files", extensions: allSupportedExtensions() },
    { name: "All Files", extensions: ["*"] },
  ];
}

export interface SaveTarget {
  path: string;
  format: DocumentFormat;
}

/**
 * Resolve the path returned by the native Save dialog into a concrete target.
 * The extension is the final source of truth: a recognised extension selects
 * the format, a missing extension is filled in from the document's current
 * format, and an unrecognised extension is rejected rather than silently
 * saved with a misleading content type.
 */
export function resolveSaveTarget(picked: string, fallback: DocumentFormat): SaveTarget | null {
  let path = picked.trim();
  if (!path) return null;
  if (path.endsWith(".")) path = path.slice(0, -1);

  const ext = extensionOf(path);
  if (!ext) {
    return { path: `${path}.${defaultExtension(fallback)}`, format: fallback };
  }
  const format = formatForExtension(ext);
  if (!format) return null;
  return { path, format };
}
