# Offline Kanban

A single-page Kanban board, wiki, and schedule that runs entirely in the browser.

<img width="1513" height="327" alt="screenshot" src="https://github.com/user-attachments/assets/96af8994-e604-40c6-be65-46a25b921927" />

---

## Why?

I wanted an offline task tracker with other features like a wiki and a Gantt Chart.

---

## Quick start

1. Download or clone this repository.
2. Open [index.html](index.html) in any modern browser (Chrome, Safari, Firefox, Edge).
3. You'll see a seeded board ("My Work") with a few example cards and a Quick Start wiki page.
4. Click **Export** before closing the tab to save a JSON backup.
5. Click **Import** and select that JSON file to pick up where you left off.

> **Heads up:** all data lives in your browser's `localStorage`. Clearing site data, switching browsers, or using a private window will wipe the board. **Export daily.**.

---

## Features

### Board view
- Multiple boards, each with custom columns (name + color).
- Cards with title, Markdown description, assignee, due date, priority, tags, checklists, and an optional linked wiki page.
- Drag-and-drop cards between columns; drag columns to reorder.
- Filter the active board by assignee or tag.
- Mark one or more columns as "Done" so completed work is styled accordingly.

### Wiki view
- Nested page tree — any page can have children.
- Markdown editor with **Edit / Split / Preview** modes.
- Tag pages and filter the tree by tag.
- Cross-link between pages with `[[Page Name]]` syntax.
- Link a Kanban card to a wiki page (and jump from the card straight to it).
- Paste or drop images directly into the editor (stored inline as base64).

### Schedule view
- Calendar grid in **Week**, **Month**, **Quarter**, **Year**, or a custom date range.
- Create labeled date "periods" (sprints, vacations, milestones) and color them.
- Filter the schedule by board so you only see the work that matters.
- Cards with due dates appear on their day.

### Activity view
A running, local log of changes.

### Import / export
- **Export** writes a timestamped `kanban-YYYY-MM-DD_HHMMSS.json` to your downloads folder.
- **Import** replaces the current state with the contents of a JSON file (it asks first).
- Drag a `.json` file directly onto the page to import.
- Optional pre-close warning if you haven't exported today.

### Themes
Three visual themes — **Crisp**, **Notebook**, **Terminal** — each with a light and dark variant. Toggle from the *Tweaks* panel or with the moon icon in the top bar.

---

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `/` or `⌘K` / `Ctrl+K` | Open search / command palette |
| `n` | New card (on Board) or new page (on Wiki) |
| `g` then `b` | Go to **B**oard |
| `g` then `s` | Go to **S**chedule |
| `g` then `w` | Go to **W**iki |
| `g` then `a` | Go to **A**ctivity |
| `⌘⇧E` / `Ctrl+Shift+E` | Export to JSON |
| `?` | Show the shortcuts panel |
| `Esc` | Close any open modal or panel |

---

## Project structure

```
.
├── index.html          # App shell
├── app.js              # All application logic (state, rendering, events)
├── markdown.js         # Tiny self-contained Markdown renderer
├── styles.css          # Themes, layout, components
└── README.md
```

### `localStorage` keys

| Key | Purpose |
| --- | --- |
| `offline_kanban_v1` | The full board / wiki / schedule state |
| `offline_kanban_settings_v1` | Theme, dark mode, export-reminder preference |
| `offline_kanban_last_export` | Timestamp of the most recent export |

---

## Data format

Exported JSON is the full `state` object. Top-level fields:

```jsonc
{
  "version": 1,
  "activeBoardId": "b_…",
  "activeView": "board",
  "activeWikiPageId": null,
  "people":  [ { "id", "name", "initials", "color" } ],
  "tags":    [ "design", "engineering", … ],
  "boards":  [ { "id", "name", "columnIds", "doneColumnIds", "filter", "created" } ],
  "columns": { "<id>": { "id", "name", "color" } },
  "cards":   { "<id>": { "id", "columnId", "title", "description",
                          "assigneeId", "due", "priority", "tags",
                          "checklist", "linkedWikiId", "archived",
                          "created", "updated" } },
  "wiki":     { "pages": { "<id>": { "id", "parentId", "title",
                                       "tags", "body", "created", "updated" } } },
  "schedule": { "periods": [ … ] },
  "activity": [ { "ts", "text" } ]
}
```

Because the format is plain JSON, exports can be diffed in git, hand-edited, or processed with `jq` if you ever need to migrate them.

---

## Limitations and trade-offs

- **No sync.** The export file *is* the sync mechanism.
- **Storage quota.** Browsers typically give `localStorage` ~5 MB per origin. Large images pasted into wiki pages will blow that out.
- **No undo history.** Deletes prompt for confirmation; once gone, they're gone (until you re-import a backup).
- **Single-user.** There's no concept of accounts or permissions..

---

## License

This project is released into the public domain under [The Unlicense](https://unlicense.org/).

You are free to copy, modify, publish, use, compile, sell, or distribute this software, in source or binary form, for any purpose, commercial or non-commercial, and by any means.

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
```

