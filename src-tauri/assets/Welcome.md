# Welcome to InkPad

InkPad is a small, fast Markdown reader and editor for Windows. This
document is your first stop: it shows what InkPad does, how it thinks about
your notes, and where the useful shortcuts live. Read it, poke at it, and
when you are ready, close it and open one of your own files.

## What InkPad is

InkPad is built around one idea: your notes belong to you. It is a quiet
tool for reading and writing plain Markdown — nothing more, nothing less.

- **A reader first.** Markdown renders instantly, with restrained typography
  and a comfortable reading column. No cards, no gradients, no clutter.
- **An editor when you need it.** Switch to the Edit view for a distraction-
  free CodeMirror editor with undo/redo, search, and replace.
- **No lock-in.** Every file is a plain `.md` or `.txt` document on your
  disk. There is no InkPad format, no import step, no export step.
- **Nothing executes.** The rendering pipeline is deliberately boring:
  `markdown-it` parses, the app escapes everything it cannot render, and
  nothing from your document is ever executed as code.

## Local-first and offline

InkPad is local-first by design. It has no accounts, no cloud, and no
telemetry. All of your work stays on your machine, in files you already
own, readable by any text editor long after InkPad is gone.

> Your notes live on your disk, in a format that will outlive any app.
> InkPad just gets out of the way.
>
> — InkPad design notes

## Core features

- Reading view with task lists, tables, code blocks, blockquotes, and
  local images
- Built-in editor with undo/redo, find, and find & replace
- Autosave — your changes are written back as you work, with `Ctrl+S` to
  save on demand
- Recent files in the sidebar, and drag & drop to open anything
- Links open in your browser; relative links resolve against the
  document's folder
- A dark and a light theme, tucked away in the toolbar menu

## Getting started

1. Open a file with the **Open File** button in the sidebar, or just drag a
   `.md` or `.txt` file into the window.
2. Read it in the reading view; switch to **Edit** when you want to change
   it.
3. Save with `Ctrl+S`, or save a copy elsewhere with `Ctrl+Shift+S`.

## Keyboard shortcuts

| Shortcut | Action |
| -------- | ------ |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+F` | Find |
| `Ctrl+H` | Find & Replace |
| `Ctrl+G` / `Ctrl+Shift+G` | Next / previous match |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Esc` | Close the search panel |

## Markdown at a glance

InkPad renders standard Markdown — here is most of it, live.

### Typography and emphasis

A regular paragraph flows at a comfortable measure, with **bold text**,
*italic text*, ***bold and italic***, and ~~strikethrough~~ rendering
distinctly but quietly. Inline `code` uses a monospace face with a subtly
raised background.

### Lists

Unordered:

- first item
- second item
- third item with **inline formatting** and `code`

Ordered:

1. first
2. second
3. third

Nested:

- parent one
  - child one
  - child two
    - grandchild one
    - grandchild two
- parent two

### Task lists

- [x] Read this welcome document
- [x] Open one of your own files
- [ ] Write something new

### Blockquotes

> A Markdown reader should be as quiet as a good book.

### Tables

| Feature     | Where to find it |
| ----------- | ---------------- |
| Reading view | Toolbar → Reading |
| Editor      | Toolbar → Edit   |
| Recent files | Sidebar          |
| Theme       | Toolbar menu     |

### Code blocks

Python:

```python
def hello(name: str) -> str:
    # greet someone
    return f"Hello, {name}!"

print(hello("InkPad"))
```

TypeScript:

```typescript
interface Document {
  path: string;
  content: string;
  dirty: boolean;
}

const doc: Document = { path: "x.md", content: "# hi", dirty: false };
export function isDirty(d: Document): boolean {
  return d.dirty;
}
```

Rust:

```rust
fn main() {
    let total: u32 = (1..=100).filter(|n| n % 3 == 0).sum();
    println!("sum: {total}");
}
```

A fenced block without a language renders unhighlighted:

```
just some plain text
  indented line
```

### Horizontal rules

Above and below:

---

### Links

- [InkPad on GitHub](https://github.com/mehul-27/InkPad) — opens in your browser
- [Back to top](#welcome-to-inkpad) — an in-document anchor
- [a sibling markdown file](notes.md) — resolves next to this document

---

That is the whole tour. Close this document when you are ready, and open
one of yours — InkPad will remember where you left off.
