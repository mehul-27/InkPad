# Markpad — V1 Product & Technical Specification

## 1. Project Definition

Markpad is a lightweight Windows-first desktop text-document application whose first-class document type is Markdown.

Its purpose is simple:

> Open Markdown quickly, read it beautifully, edit it when necessary, and stay out of the way.

It is not intended to replace VS Code, an IDE, or a full-featured writing suite.

The default experience is a polished Markdown reader. Editing is available when needed.

The application must be lightweight and responsive. Avoid Electron and avoid unnecessary background processes, dependencies, abstractions, and features.

This document is the single source of truth for V1.

---

## 2. Non-Negotiable Principles

1. Do not redesign the product or invent alternative UI patterns.
2. Do not add features that are not specified here.
3. Do not turn Markpad into an IDE.
4. Prefer the smallest reasonable implementation.
5. Do not add dependencies when the existing stack or platform APIs can reasonably handle the requirement.
6. Do not create abstractions for hypothetical future features.
7. Keep the visual design quiet, minimal, and document-focused.
8. The document must occupy most of the application window.
9. UI chrome should be secondary to the document.
10. V1 must be functional before optional polish is added.
11. Future file formats should be architecturally possible, but do not implement them merely for extensibility.
12. Do not create unnecessary project files or documentation files. Keep the project structure small and understandable.

When something is ambiguous, choose the simplest implementation consistent with this specification. Do not redesign the product to resolve minor ambiguity.

---

# 3. Technology Stack

Use:

- Tauri 2
- Svelte 5
- TypeScript
- CodeMirror 6
- markdown-it
- Rust only where native functionality is required
- CSS with semantic design tokens

Do not use:

- Electron
- React
- Next.js
- Node.js backend/server
- Express
- Redux
- Zustand
- a UI component framework
- a database
- Tailwind unless it is already required by the existing project and removing it would create unnecessary work
- an external server
- cloud services
- telemetry

The production application is a local desktop application.

---

# 4. Target Platform

Primary target:

- Windows

The architecture should remain reasonably portable through Tauri, but V1 should prioritize correct Windows behavior.

V1 should support:

- native file picker
- Windows file associations for Markdown
- drag and drop
- normal Windows window behavior
- system light/dark preference where appropriate

---

# 5. Application Shell

The main application window has two primary regions:

```text
┌──────────────────────────────────────────────────────────────┐
│ SIDEBAR       │ TOOLBAR                                     │
│               │                                              │
│ MARKPAD       │ [sidebar]  filename.md       Reading Edit ⋯ │
│               │                                              │
│ RECENT        ├──────────────────────────────────────────────┤
│               │                                              │
│ README.md     │                                              │
│ notes.md      │                 DOCUMENT                     │
│ todo.md       │                                              │
│ ideas.md      │          maximum width ~820px                │
│               │                                              │
│               │                                              │
│               │                                              │
│               │                                              │
│ Open File     │                                              │
│ Settings      │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

### Window rules

- Desktop application, not a website/dashboard.
- Minimum practical window size approximately 900×600.
- Content must resize naturally.
- No marketing landing page.
- No persistent dashboard.
- No large cards surrounding the document.
- No permanent bottom status bar in Reader mode.
- Sidebar approximately 230px wide.
- Sidebar can collapse.

---

# 6. Visual Design System

## Overall aesthetic

The application should feel:

- minimalist
- premium
- quiet
- fast
- editorial
- desktop-native
- developer-friendly without looking like an IDE

Visual references are the general restraint of applications such as Linear, Bear, Craft, Arc, and high-quality documentation readers, but Markpad must have its own identity.

Avoid:

- neon colors
- excessive gradients
- glowing effects
- excessive glassmorphism
- excessive rounded cards
- large decorative illustrations
- SaaS dashboard styling
- excessive borders
- excessive pills

Whitespace should create hierarchy.

## Default theme

The default theme is a cool charcoal dark theme.

Do not use pure black.

Approximate semantic palette:

```text
Background       near-black cool charcoal
Surface          slightly lighter charcoal
Surface raised   subtle charcoal
Foreground       warm off-white
Muted text       cool gray
Accent           restrained indigo
Borders          extremely subtle
Code background  slightly raised charcoal
```

The current design prototype uses a muted indigo/purple accent. Keep the accent restrained.

## Typography

UI and Markdown reading:

- IBM Plex Sans

Code and editor:

- JetBrains Mono

Suggested reader scale:

```text
H1: approximately 38px
H2: approximately 25–28px
H3: approximately 19–21px
Body: approximately 16–17px
Body line height: approximately 1.7–1.8
```

Editor:

```text
Editor text: approximately 14–15px
Line height: approximately 1.6–1.7
Line numbers: approximately 12px
```

Do not make headings unnecessarily huge.

---

# 7. Theme Architecture

V1 should have:

- Markpad Charcoal (default)
- Light theme

Additional themes are a post-V1 feature.

However, the implementation must use semantic design tokens so themes can be added later without rewriting components.

Define semantic tokens for at least:

```text
background
surface
surface-raised
popover

foreground
muted-foreground

accent
accent-foreground
accent-soft

border
border-strong
hairline

prose
prose-heading

code
code-background

syntax-keyword
syntax-string
syntax-number
syntax-comment
syntax-function

success
warning
error
```

Do not hardcode colors throughout individual components.

The light theme is a separate warm palette, not a simple inversion of the dark theme.

---

# 8. Sidebar

Width: approximately 230px.

Structure:

```text
MARKPAD

RECENT

README.md
project-notes.md
todo.md
ideas.md


Open File
Settings
```

### Rules

- No folders in V1.
- No project explorer.
- No workspace system.
- No tabs.
- Recent files only.
- Sidebar is collapsible.
- Open File and Settings stay near the bottom.
- Recent files should show filenames clearly.
- Modified time may be shown subtly if useful.

### Active file

The active file should have:

- slightly raised background
- brighter text
- subtle 2–3px accent indicator on the left

Do not use a large bright pill.

---

# 9. Toolbar

The toolbar is compact.

Conceptually:

```text
[sidebar]   README.md                         Reading  Edit  ⋯
```

The toolbar should contain:

Left:
- sidebar toggle
- current filename

Right:
- Reading / Edit / Split controls as appropriate
- subtle save state
- secondary actions menu

Do not create a large toolbar.

Do not fill it with icons.

Do not create a VS Code-style activity bar.

---

# 10. Reader Mode

Reader mode is the primary Markpad experience.

The document should be centered with a comfortable maximum reading width.

Recommended:

```text
Preferred width: 760–820px
Maximum width: approximately 860px
```

Do not stretch paragraphs across the full application window.

Example:

```text
                  # Building a Lightweight Desktop App

                  Markpad is a small, fast reader...

                  ## Why Markpad?

                  Markpad is designed for people...

                  ## Features

                  • Extremely lightweight
                  • Fast startup
                  • Native desktop experience
```

## Reader typography

- H1 approximately 38px
- H2 approximately 25–28px
- H3 approximately 19–21px
- body approximately 16–17px
- comfortable line height
- strong but restrained hierarchy

## Section separation

Do not automatically place horizontal lines beneath H2 or H3 headings.

Use whitespace for section separation.

Only render a horizontal rule when the Markdown itself contains:

```markdown
---
```

## Supported Markdown rendering

V1 should support:

- headings
- paragraphs
- bold
- italic
- strikethrough
- links
- ordered lists
- unordered lists
- nested lists
- blockquotes
- inline code
- fenced code blocks
- tables
- task lists
- images
- horizontal rules

Do not invent custom Markdown syntax.

---

# 11. Code Blocks

Code blocks are an important part of the reader experience.

Example:

```text
┌───────────────────────────────────────────────┐
│ python                                  Copy  │
├───────────────────────────────────────────────┤
│ def hello():                                  │
│     print("Hello")                            │
└───────────────────────────────────────────────┘
```

Rules:

- Language identifier appears subtly at top-left when available.
- Copy button appears at top-right.
- Copy button should be visually quiet and become more prominent on hover.
- Clicking Copy copies only the code contents.
- Do not copy Markdown fences.
- Button temporarily changes to `Copied`.
- Code uses JetBrains Mono.
- Syntax highlighting should be restrained.
- Do not make code blocks giant rounded cards.
- Code background is slightly raised relative to the document.

---

# 12. Copy Markdown

The user must be able to copy the entire Markdown source of the current document.

Place this action in the document secondary-actions menu.

Example:

```text
README.md                         ⋯

Copy Markdown
Save
Save As...
Reveal in Explorer
Close
```

Copy Markdown must copy the actual source, including Markdown syntax and code fences.

It must not copy rendered HTML.

The action should provide brief feedback such as:

```text
Copied
```

Do not make Copy Markdown a permanently large toolbar button.

---

# 13. Editor Mode

Use CodeMirror 6.

The editor should feel like a focused writing tool, not a miniature VS Code.

Example:

```text
1  # Building a Lightweight Desktop App
2
3  Markpad is a small, fast reader...
4
5  ## Why Markpad?
```

Rules:

- Markdown syntax highlighting.
- Line numbers enabled by default.
- Word wrap enabled by default.
- Undo/redo.
- Normal text selection/copy/paste.
- Search and replace.
- No minimap.
- No vertical ruler.
- No Git gutter.
- No Git decorations.
- No autocomplete system in V1.
- No LSP.
- No terminal.
- No file explorer beyond the Markpad recent-files sidebar.
- No VS Code activity bar.
- No unnecessary editor chrome.

---

# 14. Split Mode

Split mode displays:

```text
┌──────────────────────┬────────────────────────┐
│ Markdown source      │ Rendered Markdown      │
│                      │                        │
│ # Heading            │ Heading                │
│                      │                        │
│ Some **text**        │ Some text              │
└──────────────────────┴────────────────────────┘
```

Rules:

- Source on the left.
- Rendered result on the right.
- Subtle vertical divider.
- Both sides scroll naturally.
- Keep the implementation simple.
- No complex synchronization features beyond normal preview behavior.

Reading and Edit are the primary modes. Split is secondary.

---

# 15. Distraction-Free Mode

Distraction-free mode hides:

- sidebar
- toolbar
- unnecessary chrome

Only the document remains visible.

The document remains centered and readable.

---

# 16. Empty State

When no document is open:

```text
                    Markpad

           Your Markdown, without
          the development environment.

               Drop a file here

                    or

                 Open File
```

Keep it minimal.

No marketing hero section.

No large illustration.

No unnecessary buttons.

Drag-and-drop should be supported.

When a Markdown/text file is dragged over the window, subtly highlight the document area and show:

```text
Drop file to open
```

Do not create a giant drop zone.

---

# 17. Command Palette

Keyboard shortcut:

`Ctrl+K`

It should provide both commands and useful navigation.

Example:

```text
┌─────────────────────────────────────────┐
│ Search commands or files...             │
├─────────────────────────────────────────┤
│ Open File                         Ctrl+O │
│ Save                              Ctrl+S │
│ Toggle Reading/Edit               Ctrl+E │
│ Toggle Split View                 Ctrl+Shift+E
│ Toggle Sidebar                    Ctrl+B │
│ Search                            Ctrl+F │
│ Settings                                 │
└─────────────────────────────────────────┘
```

Rules:

- Appears quickly.
- Minimal animation.
- Keyboard-first.
- No AI features.
- Do not make it look like an AI assistant.

---

# 18. Quick File Switching

Use:

`Ctrl+P`

to open a lightweight recent-file/file switcher.

It should allow the user to quickly select recently opened files.

Do not implement a full project file explorer.

---

# 19. Search

Use:

`Ctrl+F`

for in-document search.

Use:

`Ctrl+H`

for replace.

Search UI should be compact.

Show:

- search input
- match count
- previous/next
- close

Do not create a large search page.

---

# 20. Document Outline

Shortcut:

`Ctrl+Shift+O`

Show headings from the current Markdown document.

Example:

```text
OUTLINE

Project
  Installation
  Configuration
  Usage
  API
  Troubleshooting
```

The outline should be temporary/optional, not a permanent large panel.

Clicking a heading navigates to that section.

---

# 21. Settings

V1 settings should remain small.

Categories:

## Appearance

- Theme
- Font size
- Content width

## Editor

- Word wrap
- Line numbers
- Tab size

## Files

- Autosave
- Restore previous files

Do not create a large settings application.

---

# 22. Generic Document Model

Markpad is a lightweight text-document application whose first-class document type is Markdown.

The core document model must not assume every document is Markdown.

Conceptually:

```text
Document
├── path
├── filename
├── extension
├── content
├── language
├── modified/dirty state
└── capabilities
```

Possible capabilities:

```text
canEdit
canRender
canSyntaxHighlight
canSave
canCopySource
```

V1 document types:

### Markdown

Extensions:

- `.md`
- `.markdown`

Capabilities:

```text
canEdit = true
canRender = true
canSyntaxHighlight = true
canSave = true
canCopySource = true
```

### Plain text

Extension:

- `.txt`

Capabilities:

```text
canEdit = true
canRender = false
canSyntaxHighlight = false
canSave = true
canCopySource = true
```

Future formats may include:

- `.json`
- `.jsonc`
- `.yaml`
- `.yml`
- `.toml`
- `.xml`
- `.csv`
- `.ini`
- `.conf`
- source code files

Do not implement those formats in V1 unless necessary for basic file opening behavior.

The architecture should make adding them later straightforward.

---

# 23. Plain Text Behavior

TXT files should be supported in V1.

TXT should use the same document/file infrastructure and editor.

TXT files:

- open normally
- edit normally
- save normally
- autosave normally
- appear in Recent
- support search
- support Copy Source

They should not expose Markdown-specific Reader functionality.

If the application does not have a meaningful rendered representation for a file type, it should simply use the editor.

---

# 24. File Operations

V1 must support:

- Open
- Save
- Save As
- Close document
- Drag and drop
- Recent files
- Reveal in Explorer
- Markdown file association

File operations must happen through the appropriate Tauri/native filesystem functionality.

Do not create a server.

---

# 25. Autosave

Autosave is a core V1 feature.

Do not write to disk on every keystroke.

Behavior:

```text
User edits
    ↓
document marked dirty
    ↓
wait approximately 750ms after last edit
    ↓
autosave
    ↓
document marked saved
```

Also save when:

- `Ctrl+S`
- switching files
- switching away from the application/window where appropriate
- closing the application

The UI should show a quiet save state:

```text
Saved
Saving...
Unsaved
```

Do not use persistent bright green indicators.

Autosave should not interrupt the user's work.

---

# 26. Atomic File Writes

Saving must be safe.

Do not directly truncate/overwrite the user's original file before the replacement content has been safely written.

Use an atomic or otherwise crash-safe file replacement strategy appropriate for the target platform.

Conceptually:

```text
Original file
     ↓
write temporary file
     ↓
successfully flush/write
     ↓
replace original safely
```

The goal is to minimize the possibility of destroying a document because of a crash or interrupted write.

---

# 27. External File Modification

Markpad may be used alongside VS Code, OpenCode, Git, terminal editors, etc.

Therefore detect when an open document has changed externally.

If the document has NOT been modified inside Markpad:

- reload the external version automatically or offer a quiet reload.

If the document HAS local unsaved changes:

Do not silently overwrite either version.

Show a simple prompt:

```text
README.md was modified outside Markpad.

[ Reload File ]    [ Keep My Changes ]
```

Keep conflict handling simple in V1.

Do not implement a full three-way merge system.

---

# 28. Encoding and Newlines

V1 should primarily use UTF-8.

Preserve reasonable newline behavior when saving.

Do not unnecessarily rewrite entire documents into a different line-ending format unless required.

Do not implement a large encoding-management system in V1.

---

# 29. Recent Files

Store a small list of recently opened files locally.

Do not use a database.

A small local configuration/JSON file is sufficient.

Recent files should:

- persist between launches
- show filename
- optionally show path/metadata subtly
- remove missing files gracefully
- have a simple clear/recent management option if useful

Do not create folders/workspaces.

---

# 30. Keyboard Shortcuts

V1 shortcuts:

| Shortcut | Action |
|---|---|
| Ctrl+O | Open File |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+K | Command Palette |
| Ctrl+P | Quick File Switcher |
| Ctrl+F | Search |
| Ctrl+H | Replace |
| Ctrl+E | Toggle Reading/Edit |
| Ctrl+Shift+E | Split View |
| Ctrl+B | Toggle Sidebar |
| Ctrl+Shift+F | Distraction-Free Mode |
| Ctrl+Shift+O | Document Outline |
| Esc | Close overlays/panels |

Shortcuts should work consistently across the application.

Do not add dozens of shortcuts in V1.

---

# 31. V1 Feature List

## Core

- Markdown open/edit/save
- Plain text open/edit/save
- Open
- Save
- Save As
- Drag/drop
- Recent files
- File association
- Reveal in Explorer
- Autosave
- Atomic writes
- External modification detection
- UTF-8
- sensible newline preservation

## Reader

- centered reading layout
- headings
- paragraphs
- emphasis
- strikethrough
- links
- lists
- nested lists
- blockquotes
- task lists
- tables
- images
- inline code
- code blocks
- syntax highlighting
- copy code
- copy Markdown source
- heading navigation/anchors
- document outline

## Editor

- CodeMirror 6
- Markdown syntax highlighting
- line numbers
- word wrap
- undo/redo
- search
- replace
- keyboard shortcuts

## Modes

- Reading
- Edit
- Split
- Distraction-free

## Navigation

- Recent files
- Command palette
- Quick file switcher
- Search
- Outline

## UI

- Cool charcoal default theme
- Light theme
- theme-token architecture
- collapsible sidebar
- minimal toolbar
- quiet save state

---

# 32. V1 Non-Goals

Do NOT implement:

- accounts
- cloud sync
- collaboration
- AI
- AI chat
- plugins
- extensions
- Git integration
- terminal
- workspaces
- project management
- database
- telemetry
- cloud storage
- publishing
- web server
- package manager
- LSP
- autocomplete
- code intelligence
- debugger
- tabs
- complex file explorer
- Markdown publishing
- online synchronization
- custom theme marketplace

These may be considered in the future, but they are explicitly outside V1.

---

# 33. Performance Requirements

Markpad is a lightweight desktop utility, not an IDE.

Avoid:

- Electron
- unnecessary background processes
- unnecessary polling
- large UI frameworks
- unnecessary state-management libraries
- databases
- network requests during normal local use
- telemetry

Do not make arbitrary RAM promises before measurement.

After V1 exists, measure:

- cold startup time
- warm startup time
- idle RAM
- RAM with a normal Markdown file
- RAM with a large Markdown file
- RAM after switching between several files
- idle CPU
- CPU during editing
- CPU during Markdown rendering

The application should remain responsive with normal and reasonably large text/Markdown files.

---

# 34. Implementation Discipline

Before modifying code:

1. Inspect the existing project.
2. Read this specification.
3. Understand the current implementation.
4. Make the smallest change needed.
5. Do not rewrite unrelated components.

Do not:

- redesign the UI
- introduce alternative frameworks
- introduce unnecessary dependencies
- create a large architecture for hypothetical future requirements
- rename working components without a reason
- create unnecessary files
- turn simple logic into many layers
- add features because they "might be useful"

If an implementation can reasonably be solved in a small number of clear components, prefer that.

Keep the code readable enough that another AI agent can understand it later.

---

# 35. Development Order

Implement V1 in these phases.

## Phase 1 — Application Shell

Implement:

- Tauri + Svelte + TypeScript setup
- desktop window
- cool charcoal theme
- light theme infrastructure
- semantic design tokens
- sidebar
- toolbar
- empty state
- basic Reader/Edit mode shell

Do not implement advanced Markdown or file operations yet.

## Phase 2 — Files and Documents

Implement:

- generic document model
- Markdown files
- TXT files
- Open
- Save
- Save As
- drag/drop
- Recent files
- file association
- Reveal in Explorer

## Phase 3 — Markdown Reader

Implement:

- markdown-it
- Markdown rendering
- typography
- links
- lists
- tables
- images
- blockquotes
- tasks
- code blocks
- restrained syntax highlighting
- code copy
- Markdown source copy

## Phase 4 — Editor and Autosave

Implement:

- CodeMirror 6
- Markdown editing
- TXT editing
- line numbers
- word wrap
- search
- replace
- undo/redo
- autosave
- atomic writes
- save state

## Phase 5 — Navigation

Implement:

- command palette
- quick file switcher
- keyboard shortcuts
- document outline

## Phase 6 — Modes and Polish

Implement:

- Split mode
- Distraction-free mode
- external modification detection
- final interaction polish
- light theme refinement
- hover/focus states
- subtle transitions

## Phase 7 — Testing and Optimization

Test:

- opening files
- saving
- autosave
- external modification
- large Markdown files
- images
- tables
- code blocks
- unusual Markdown
- TXT
- drag/drop
- file association
- keyboard shortcuts
- theme switching
- window resizing
- closing during save

Fix bugs before adding optional features.

---

# 36. Completion Criteria

V1 is complete when a user can:

1. Double-click a `.md` file and open it in Markpad.
2. Read the Markdown in a polished, comfortable layout.
3. Switch to Edit mode.
4. Make changes.
5. Have those changes autosaved safely.
6. Switch back to Reading mode.
7. Copy an individual code block.
8. Copy the entire Markdown source.
9. Search the document.
10. Navigate through the document outline.
11. Open another Markdown or TXT file.
12. Drag a file into Markpad.
13. Find recent files after restarting the application.
14. Use the command palette.
15. Enter distraction-free mode.
16. Use the application in both dark and light themes.
17. Continue using the application alongside VS Code/OpenCode without file corruption or silent overwrite.

---

# 37. Final Product Rule

Whenever a proposed feature or implementation decision is considered, ask:

> Does this make Markpad better at being a lightweight Markdown/text notebook, or does it make Markpad more like an IDE?

If it makes Markpad more like an IDE, it is probably not needed.

The core product remains:

> Open Markdown. Read it beautifully. Edit it when necessary. Save it quietly. Get out of the way.
