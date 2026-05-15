/* =====================================================================
   OFFLINE KANBAN — app.js
   Vanilla JS, no external deps. All state in localStorage. Export/import JSON.
   ===================================================================== */
(function () {
"use strict";

// ---------- Storage ----------
const STORAGE_KEY = "offline_kanban_v1";
const SETTINGS_KEY = "offline_kanban_settings_v1";
const LAST_EXPORT_KEY = "offline_kanban_last_export";

const uid = (p = "id") => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();

// ---------- Default seed (modest, gives the user a starting layout) ----------
function makeSeed() {
  const b1 = uid("b");
  const c1 = uid("c"), c2 = uid("c"), c3 = uid("c"), c4 = uid("c");
  const k1 = uid("k"), k2 = uid("k"), k3 = uid("k");
  const w1 = uid("w");
  return {
    version: 1,
    activeBoardId: b1,
    activeView: "board",
    activeWikiPageId: null,
    people: [
      { id: uid("p"), name: "Me", initials: "ME", color: "#4f46e5" }
    ],
    tags: ["design", "engineering", "ops", "research"],
    boards: [{
      id: b1,
      name: "My Work",
      columnIds: [c1, c2, c3, c4],
      doneColumnIds: [c4],
      filter: { assignee: null, tag: null },
      created: now()
    }],
    columns: {
      [c1]: { id: c1, name: "Backlog", color: "#737373" },
      [c2]: { id: c2, name: "Today", color: "#4f46e5" },
      [c3]: { id: c3, name: "In progress", color: "#d97706" },
      [c4]: { id: c4, name: "Done", color: "#059669" },
    },
    cards: {
      [k1]: {
        id: k1, columnId: c1, title: "Welcome — try dragging me across columns",
        description: "This card lives in Backlog. Drag it into **Today** to get started.\n\n- Click to open this card and edit anything\n- Use the `/` key to search\n- Press `?` to see all shortcuts",
        assigneeId: null, due: null, priority: "Med", tags: ["design"],
        checklist: [
          { id: uid("ch"), text: "Try drag & drop", done: false },
          { id: uid("ch"), text: "Open this card", done: true },
          { id: uid("ch"), text: "Export your data", done: false }
        ],
        linkedWikiId: w1, archived: false,
        created: now(), updated: now()
      },
      [k2]: {
        id: k2, columnId: c2, title: "Export the board to JSON daily",
        description: "Offline only — your browser may clear data. Use **Export** to save a file you can re-import tomorrow.",
        assigneeId: null, due: null, priority: "High", tags: ["ops"],
        checklist: [], linkedWikiId: null, archived: false,
        created: now(), updated: now()
      },
      [k3]: {
        id: k3, columnId: c3, title: "Read the Quick Start wiki page",
        description: "", assigneeId: null, due: null, priority: "Low", tags: [],
        checklist: [], linkedWikiId: w1, archived: false,
        created: now(), updated: now()
      }
    },
    wiki: {
      pages: {
        [w1]: {
          id: w1, parentId: null, title: "Quick Start",
          tags: ["guide"],
          body: `# Quick Start

Welcome to your **offline Kanban + Wiki**. Everything is saved locally — nothing leaves your machine.

## Daily routine
1. Open this file in your browser
2. Click **Import** and load yesterday's \`kanban-YYYY-MM-DD.json\`
3. Do work
4. Click **Export** before closing the tab

## Wiki tips
- Pages are nested in a tree — use the **+** next to any page to add a child
- Tag pages from the title bar; filter by tag in the sidebar
- Link from a card to a page using the card's "Linked wiki page" field
- Use \`[[Quick Start]]\` syntax to link between pages

## Keyboard
- \`/\` — search
- \`?\` — shortcuts
- \`n\` — new card / new page (depending on view)
- \`g b\` then \`g w\` — switch between Board and Wiki
- \`Esc\` — close any panel`,
          created: now(), updated: now()
        }
      },
      rootOrder: [w1],
      expanded: { [w1]: true }
    },
    activity: [
      { id: uid("a"), at: now(), text: "Created your first board <em>My Work</em>" }
    ]
  };
}

// ---------- State ----------
let state = null;
let settings = { theme: "crisp", mode: "light", exportReminder: true };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : makeSeed();
  } catch (e) {
    state = makeSeed();
  }
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) settings = Object.assign(settings, JSON.parse(s));
  } catch (e) {}
  // Ensure structure for older imports
  state.activity = state.activity || [];
  state.tags = state.tags || [];
  state.people = state.people || [];
  ensureColumnOrders();
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Couldn't auto-save — storage may be full.", "warn");
    }
    renderStorageMeter();
  }, 200);
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------- Storage usage ----------
// Most browsers cap localStorage at ~5MB per origin. We probe at first use to refine.
let STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
function fmtBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024*1024) return (b/1024).toFixed(b < 10*1024 ? 1 : 0) + " KB";
  return (b/1024/1024).toFixed(b < 10*1024*1024 ? 2 : 1) + " MB";
}
function measureStorageUsage() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || "";
      // UTF-16 storage — count by char × 2 for an upper-bound estimate
      bytes += (k.length + v.length) * 2;
    }
  } catch (e) {}
  return bytes;
}
async function probeStorageQuota() {
  // Try the StorageManager API first (gives total origin quota, not just LS — still informative)
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (est && est.quota) {
        // Don't use the full origin quota — localStorage cap is much smaller (~5-10 MB).
        // Use 5 MB as the conservative LS bound regardless; only widen if estimate suggests otherwise.
      }
    } catch (e) {}
  }
}
function renderStorageMeter() {
  const meter = document.getElementById("storage-meter");
  const fill = document.getElementById("storage-fill");
  const label = document.getElementById("storage-label");
  if (!meter || !fill || !label) return;
  const used = measureStorageUsage();
  const pct = Math.min(100, (used / STORAGE_QUOTA_BYTES) * 100);
  fill.style.width = pct.toFixed(1) + "%";
  label.textContent = `${pct.toFixed(pct < 10 ? 1 : 0)}% · ${fmtBytes(used)}`;
  meter.title = `localStorage: ${fmtBytes(used)} / ~${fmtBytes(STORAGE_QUOTA_BYTES)} (${pct.toFixed(1)}% used)`;
  meter.classList.toggle("warn", pct >= 60 && pct < 85);
  meter.classList.toggle("crit", pct >= 85);
}
function logActivity(text) {
  state.activity.unshift({ id: uid("a"), at: now(), text });
  if (state.activity.length > 500) state.activity.length = 500;
  save();
}

// ---------- Theme ----------
function applyTheme() {
  document.documentElement.setAttribute("data-theme", settings.theme);
  document.documentElement.setAttribute("data-mode", settings.mode);
}

// ---------- Helpers ----------
function activeBoard() { return state.boards.find(b => b.id === state.activeBoardId); }
function getColumn(id) { return state.columns[id]; }

// Ensure each column has a cardIds array (migration for older data + invariant maintenance)
function ensureColumnOrders() {
  // First, build sets per column from card.columnId truth
  const cardsByCol = {};
  Object.values(state.cards).forEach(c => {
    if (!c) return;
    if (!cardsByCol[c.columnId]) cardsByCol[c.columnId] = [];
    cardsByCol[c.columnId].push(c);
  });
  Object.values(state.columns).forEach(col => {
    if (!col.cardIds) col.cardIds = [];
    // Drop any stale ids (cards moved away / deleted)
    col.cardIds = col.cardIds.filter(id => state.cards[id] && state.cards[id].columnId === col.id);
    // Append any cards belonging here that aren't already in the list, sorted by created
    const known = new Set(col.cardIds);
    const missing = (cardsByCol[col.id] || []).filter(c => !known.has(c.id))
      .sort((a, b) => new Date(a.created) - new Date(b.created));
    missing.forEach(c => col.cardIds.push(c.id));
  });
}

function cardsInColumn(colId, opts = {}) {
  const board = activeBoard();
  const filter = board.filter || {};
  const showArchived = !!opts.showArchived;
  const col = state.columns[colId];
  if (!col) return [];
  if (!col.cardIds) col.cardIds = [];
  return col.cardIds
    .map(id => state.cards[id])
    .filter(c => {
      if (!c) return false;
      if (c.columnId !== colId) return false;
      if (!showArchived && c.archived) return false;
      if (filter.assignee && c.assigneeId !== filter.assignee) return false;
      if (filter.tag && !(c.tags || []).includes(filter.tag)) return false;
      return true;
    });
}
function personOf(id) { return state.people.find(p => p.id === id); }
function initials(name) {
  return name.trim().split(/\s+/).map(s => s[0]).join("").slice(0, 2).toUpperCase();
}
function pickAvatarColor(name) {
  // deterministic hash → hue
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffffff;
  const hue = h % 360;
  return `oklch(0.62 0.13 ${hue})`;
}
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  const today = new Date(); today.setHours(0,0,0,0);
  const dd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diff = Math.round((dd - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 0 && diff < 7) return dt.toLocaleDateString(undefined, { weekday: "short" });
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s/60) + "m ago";
  if (s < 86400) return Math.round(s/3600) + "h ago";
  const d = Math.round(s/86400);
  if (d < 30) return d + "d ago";
  return new Date(iso).toLocaleDateString();
}

// ---------- Toasts ----------
const toastHost = document.getElementById("toast-host");
function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.innerHTML = text;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .2s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

// ---------- Render: Topbar ----------
function renderTopbar() {
  const reminderEl = document.getElementById("export-reminder");
  const last = parseInt(localStorage.getItem(LAST_EXPORT_KEY) || "0", 10);
  const hoursAgo = (Date.now() - last) / 3600000;
  if (settings.exportReminder && (!last || hoursAgo > 20)) {
    reminderEl.style.display = "inline-block";
    reminderEl.textContent = last ? `Last export ${relTime(new Date(last).toISOString())}` : "Not exported yet";
  } else {
    reminderEl.style.display = "none";
  }
  document.querySelectorAll(".topbar .tab").forEach(t => {
    t.classList.toggle("active", t.dataset.view === state.activeView);
  });
}

// ---------- Render: Board ----------
function renderBoard() {
  const board = activeBoard();
  if (!board) return;

  // ---------- Sidebar: board list ----------
  const list = document.getElementById("board-list");
  list.innerHTML = "";
  state.boards.forEach(b => {
    const cardCount = Object.values(state.cards).filter(c => {
      const col = state.columns[c.columnId];
      return col && b.columnIds.includes(c.columnId) && !c.archived;
    }).length;
    const row = document.createElement("div");
    row.className = "board-row" + (b.id === state.activeBoardId ? " active" : "");
    row.innerHTML = `
      <span class="icon">${svgIcon("board", 13)}</span>
      <span class="name"></span>
      <span class="count">${cardCount}</span>
      <button class="row-menu" title="Board options">${svgIcon("dots", 12)}</button>
    `;
    row.querySelector(".name").textContent = b.name;
    row.title = "Click to switch · double-click to rename · right-click for options";
    row.addEventListener("click", (e) => {
      if (e.target.closest(".row-menu")) return;
      state.activeBoardId = b.id;
      save();
      renderBoard();
    });
    row.addEventListener("dblclick", () => renameBoard(b));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openBoardTabMenu(e.clientX, e.clientY, b);
    });
    row.querySelector(".row-menu").addEventListener("click", (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      openBoardTabMenu(r.left, r.bottom + 4, b);
    });
    list.appendChild(row);
  });

  // ---------- Top filter bar ----------
  const bar = document.getElementById("board-bar");
  bar.innerHTML = "";
  // Active board title (read-only, here for context)
  const title = document.createElement("div");
  title.className = "board-title-inline";
  title.textContent = board.name;
  bar.appendChild(title);
  const sp = document.createElement("div");
  sp.style.flex = "1";
  bar.appendChild(sp);

  // Filter chips
  const filter = board.filter || {};
  // Assignee filter
  const fa = document.createElement("button");
  fa.className = "filter-chip" + (filter.assignee ? " active" : "");
  const aName = filter.assignee ? (personOf(filter.assignee)?.name || "Person") : "All people";
  fa.innerHTML = svgIcon("user", 11) + `<span>${esc(aName)}</span><span class="x">×</span>`;
  fa.addEventListener("click", (e) => {
    if (e.target.classList.contains("x") && filter.assignee) {
      filter.assignee = null; save(); renderBoard(); return;
    }
    openAssigneeFilter(fa);
  });
  bar.appendChild(fa);
  // Tag filter
  const ft = document.createElement("button");
  ft.className = "filter-chip" + (filter.tag ? " active" : "");
  ft.innerHTML = svgIcon("tag", 11) + `<span>${esc(filter.tag || "All tags")}</span><span class="x">×</span>`;
  ft.addEventListener("click", (e) => {
    if (e.target.classList.contains("x") && filter.tag) {
      filter.tag = null; save(); renderBoard(); return;
    }
    openTagFilter(ft);
  });
  bar.appendChild(ft);

  // Show archived toggle
  bar.appendChild((function () {
    const b = document.createElement("button");
    b.className = "filter-chip" + (board.showArchived ? " active" : "");
    b.innerHTML = svgIcon("archive", 11) + `<span>${board.showArchived ? "Showing archived" : "Hide archived"}</span>`;
    b.addEventListener("click", () => {
      board.showArchived = !board.showArchived;
      save();
      renderBoard();
    });
    return b;
  })());

  // Columns
  const canvas = document.getElementById("board-canvas");
  canvas.innerHTML = "";
  board.columnIds.forEach(cid => {
    const col = state.columns[cid]; if (!col) return;
    canvas.appendChild(renderColumn(col, board));
  });
  // ---------- Column drop handling on the canvas ----------
  function clearColDropIndicators() {
    canvas.querySelectorAll(".column.col-drop-left, .column.col-drop-right").forEach(c => {
      c.classList.remove("col-drop-left", "col-drop-right");
    });
  }
  function findColDropTarget(clientX) {
    const cols = [...canvas.querySelectorAll(".column:not(.col-dragging)")];
    for (const colEl of cols) {
      const r = colEl.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      if (clientX < mid) return { before: colEl };
    }
    return { before: null };
  }
  canvas.addEventListener("dragover", e => {
    if (!e.dataTransfer.types.includes("text/columnid")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearColDropIndicators();
    const tgt = findColDropTarget(e.clientX);
    if (tgt.before) tgt.before.classList.add("col-drop-left");
    else {
      const last = canvas.querySelector(".column:not(.col-dragging):last-of-type");
      if (last) last.classList.add("col-drop-right");
    }
  });
  canvas.addEventListener("dragleave", (e) => {
    if (!canvas.contains(e.relatedTarget)) clearColDropIndicators();
  });
  canvas.addEventListener("drop", e => {
    if (!e.dataTransfer.types.includes("text/columnid")) return;
    e.preventDefault();
    clearColDropIndicators();
    const colId = e.dataTransfer.getData("text/columnid");
    if (!colId) return;
    const tgt = findColDropTarget(e.clientX);
    moveColumn(colId, tgt.before ? tgt.before.dataset.colId : null);
  });

  // Add column placeholder
  const addCol = document.createElement("div");
  addCol.className = "add-column";
  addCol.innerHTML = svgIcon("plus", 12) + " Add column";
  addCol.addEventListener("click", () => {
    const name = prompt("Column name", "New");
    if (!name || !name.trim()) return;
    const id = uid("c");
    state.columns[id] = { id, name: name.trim(), color: "#737373" };
    board.columnIds.push(id);
    logActivity(`Added column <em>${esc(name.trim())}</em>`);
    save();
    renderBoard();
  });
  canvas.appendChild(addCol);
}

function renderColumn(col, board) {
  const cards = cardsInColumn(col.id, { showArchived: !!board.showArchived });
  const wrap = document.createElement("div");
  wrap.className = "column";
  wrap.dataset.colId = col.id;
  wrap.draggable = false; // we toggle this from the head drag handle

  const head = document.createElement("div");
  head.className = "column-head";
  head.innerHTML = `
    <span class="col-drag-handle" title="Drag to reorder column">${svgIcon("grip", 12)}</span>
    <span class="dot" style="background:${col.color}"></span>
    <span class="title" contenteditable="true" spellcheck="false">${esc(col.name)}</span>
    <span class="count">${cards.length}</span>
    <button class="menu-btn" title="Column options">${svgIcon("dots", 14)}</button>
  `;
  const titleEl = head.querySelector(".title");
  titleEl.addEventListener("blur", () => {
    const v = titleEl.textContent.trim() || col.name;
    if (v !== col.name) {
      col.name = v;
      logActivity(`Renamed column to <em>${esc(v)}</em>`);
      save();
      renderBoard();
    }
  });
  titleEl.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
  });
  head.querySelector(".menu-btn").addEventListener("click", e => {
    e.stopPropagation();
    openColumnMenu(e.currentTarget, col, board);
  });
  wrap.appendChild(head);

  const body = document.createElement("div");
  body.className = "column-body";
  body.dataset.colId = col.id;
  cards.forEach(c => body.appendChild(renderCard(c)));
  wrap.appendChild(body);

  // ---------- Card DnD: reorder + cross-column move ----------
  function clearCardDropIndicators() {
    wrap.querySelectorAll(".card.drop-above, .card.drop-below").forEach(c => {
      c.classList.remove("drop-above", "drop-below");
    });
  }
  function findDropTarget(clientY) {
    const visibleCards = [...body.querySelectorAll(".card:not(.dragging)")];
    for (const card of visibleCards) {
      const r = card.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (clientY < mid) return { before: card };
    }
    return { before: null }; // drop at end
  }
  body.addEventListener("dragover", e => {
    if (!e.dataTransfer.types.includes("text/cardid") && !e.dataTransfer.types.includes("text/columnid")) return;
    if (e.dataTransfer.types.includes("text/columnid")) return; // handled at canvas
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    wrap.classList.add("drag-over");
    clearCardDropIndicators();
    const tgt = findDropTarget(e.clientY);
    if (tgt.before) tgt.before.classList.add("drop-above");
    else {
      const last = body.querySelector(".card:not(.dragging):last-of-type");
      if (last) last.classList.add("drop-below");
    }
  });
  body.addEventListener("dragleave", (e) => {
    // Only clear when leaving the column entirely
    if (!body.contains(e.relatedTarget)) {
      wrap.classList.remove("drag-over");
      clearCardDropIndicators();
    }
  });
  body.addEventListener("drop", e => {
    e.preventDefault();
    wrap.classList.remove("drag-over");
    clearCardDropIndicators();
    const cardId = e.dataTransfer.getData("text/cardid");
    if (!cardId) return;
    const tgt = findDropTarget(e.clientY);
    moveCard(cardId, col.id, tgt.before ? tgt.before.dataset.cardId : null);
  });

  const foot = document.createElement("div");
  foot.className = "column-foot";
  const addBtn = document.createElement("button");
  addBtn.className = "add-card-btn";
  addBtn.innerHTML = svgIcon("plus", 12) + " New card";
  addBtn.addEventListener("click", () => addCard(col.id));
  foot.appendChild(addBtn);
  wrap.appendChild(foot);

  // ---------- Column DnD via the grip handle ----------
  const grip = head.querySelector(".col-drag-handle");
  grip.addEventListener("mousedown", () => { wrap.draggable = true; });
  // Reset draggable after mouseup so card drags from inside don't accidentally become column drags
  document.addEventListener("mouseup", () => { wrap.draggable = false; }, { once: true });
  wrap.addEventListener("dragstart", e => {
    if (!wrap.draggable) return;
    e.dataTransfer.setData("text/columnid", col.id);
    e.dataTransfer.effectAllowed = "move";
    wrap.classList.add("col-dragging");
  });
  wrap.addEventListener("dragend", () => {
    wrap.classList.remove("col-dragging");
    wrap.draggable = false;
  });

  return wrap;
}

function renderCard(c) {
  const el = document.createElement("div");
  el.className = "card";
  el.draggable = true;
  el.dataset.cardId = c.id;
  if (c.archived) el.style.opacity = 0.55;

  const meta = [];
  if (c.priority && c.priority !== "None") {
    const cls = c.priority === "High" ? "priority-high" : c.priority === "Med" ? "priority-med" : "priority-low";
    meta.push(`<span class="tag ${cls}">${c.priority}</span>`);
  }
  if (c.due) {
    const d = new Date(c.due);
    const today = new Date(); today.setHours(0,0,0,0);
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((dd - today) / 86400000);
    let cls = "";
    if (diff < 0) cls = "due-late";
    else if (diff <= 2) cls = "due-soon";
    meta.push(`<span class="tag ${cls}">${svgIcon("clock", 9)} ${fmtDate(c.due)}</span>`);
  }
  (c.tags || []).slice(0, 3).forEach(t => meta.push(`<span class="tag">${esc(t)}</span>`));
  if (c.linkedWikiId && state.wiki.pages[c.linkedWikiId]) {
    const wp = state.wiki.pages[c.linkedWikiId];
    meta.push(`<a class="tag wiki-link" data-wiki-id="${c.linkedWikiId}" title="Open: ${esc(wp.title)}" href="#wiki:${c.linkedWikiId}">${svgIcon("book", 9)} ${esc(wp.title.slice(0, 18))}${wp.title.length>18?"…":""}</a>`);
  }
  const total = (c.checklist || []).length;
  const done = (c.checklist || []).filter(x => x.done).length;
  if (total) meta.push(`<span class="tag">${svgIcon("check", 9)} ${done}/${total}</span>`);

  const assignee = personOf(c.assigneeId);
  const avatarHTML = assignee
    ? `<span class="avatar" style="background:${assignee.color || pickAvatarColor(assignee.name)}" title="${esc(assignee.name)}">${esc(assignee.initials || initials(assignee.name))}</span>`
    : "";

  el.innerHTML = `
    <div class="card-title">${esc(c.title)}</div>
    ${meta.length || avatarHTML ? `<div class="card-meta">${meta.join("")}${avatarHTML ? `<div style="margin-left:auto">${avatarHTML}</div>` : ""}</div>` : ""}
    ${total ? `<div class="progress-bar"><div style="width:${Math.round(done/total*100)}%"></div></div>` : ""}
  `;
  el.addEventListener("click", (e) => {
    const link = e.target.closest(".wiki-link");
    if (link) {
      e.stopPropagation();
      e.preventDefault();
      state.activeWikiPageId = link.dataset.wikiId;
      save();
      setView("wiki");
      return;
    }
    openCardModal(c.id);
  });
  el.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/cardid", c.id);
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  return el;
}

function moveCard(cardId, newColId, beforeCardId) {
  const c = state.cards[cardId];
  if (!c) return;
  const fromCol = state.columns[c.columnId];
  const toCol = state.columns[newColId];
  if (!fromCol || !toCol) return;

  // Detach from old
  fromCol.cardIds = (fromCol.cardIds || []).filter(id => id !== cardId);
  // Insert into new
  toCol.cardIds = toCol.cardIds || [];
  // Make sure we don't double-insert
  toCol.cardIds = toCol.cardIds.filter(id => id !== cardId);
  if (beforeCardId) {
    const idx = toCol.cardIds.indexOf(beforeCardId);
    if (idx >= 0) toCol.cardIds.splice(idx, 0, cardId);
    else toCol.cardIds.push(cardId);
  } else {
    toCol.cardIds.push(cardId);
  }

  const movedColumn = c.columnId !== newColId;
  c.columnId = newColId;
  c.updated = now();
  if (movedColumn) {
    logActivity(`Moved <b>${esc(c.title)}</b> from <em>${esc(fromCol.name)}</em> to <em>${esc(toCol.name)}</em>`);
  }
  save();
  renderBoard();
}

// Backward-compat alias used in a few places
function moveCardToColumn(cardId, newColId) {
  moveCard(cardId, newColId, null);
}

function moveColumn(colId, beforeColId) {
  const board = activeBoard();
  const ids = board.columnIds.filter(id => id !== colId);
  if (beforeColId && beforeColId !== colId) {
    const idx = ids.indexOf(beforeColId);
    if (idx >= 0) ids.splice(idx, 0, colId);
    else ids.push(colId);
  } else {
    ids.push(colId);
  }
  board.columnIds = ids;
  save();
  renderBoard();
}

function addCard(colId) {
  const id = uid("k");
  state.cards[id] = {
    id, columnId: colId, title: "New card", description: "",
    assigneeId: null, due: null, priority: "None", tags: [],
    checklist: [], linkedWikiId: null, archived: false,
    created: now(), updated: now()
  };
  const col = state.columns[colId];
  if (col) {
    col.cardIds = col.cardIds || [];
    col.cardIds.push(id);
  }
  logActivity(`Added card in <em>${esc(state.columns[colId].name)}</em>`);
  save();
  renderBoard();
  openCardModal(id, true);
}

function renameBoard(b) {
  const name = prompt("Rename board", b.name);
  if (name && name.trim()) {
    b.name = name.trim();
    logActivity(`Renamed board to <em>${esc(b.name)}</em>`);
    save();
    renderBoard();
  }
}

function deleteBoard(b) {
  if (state.boards.length <= 1) {
    toast("Can't delete your only board.", "warn");
    return;
  }
  const cardCount = Object.values(state.cards).filter(c => b.columnIds.includes(c.columnId)).length;
  const msg = cardCount
    ? `Delete board "${b.name}"?\n\nThis will also delete ${cardCount} card${cardCount===1?"":"s"} and ${b.columnIds.length} column${b.columnIds.length===1?"":"s"}.\n\nThis cannot be undone.`
    : `Delete board "${b.name}" and its ${b.columnIds.length} column${b.columnIds.length===1?"":"s"}?`;
  if (!confirm(msg)) return;
  // remove cards in this board's columns
  Object.values(state.cards).forEach(c => {
    if (b.columnIds.includes(c.columnId)) delete state.cards[c.id];
  });
  // remove the columns
  b.columnIds.forEach(cid => delete state.columns[cid]);
  // remove the board
  const idx = state.boards.findIndex(x => x.id === b.id);
  state.boards.splice(idx, 1);
  // pick a new active board
  if (state.activeBoardId === b.id) {
    state.activeBoardId = state.boards[Math.max(0, idx-1)].id;
  }
  logActivity(`Deleted board <em>${esc(b.name)}</em>`);
  save();
  renderBoard();
}

function duplicateBoard(b) {
  const newId = uid("b");
  const idMap = {};
  const newCols = b.columnIds.map(cid => {
    const newCid = uid("c");
    idMap[cid] = newCid;
    state.columns[newCid] = { ...state.columns[cid], id: newCid };
    return newCid;
  });
  Object.values(state.cards).forEach(c => {
    if (b.columnIds.includes(c.columnId)) {
      const newKid = uid("k");
      state.cards[newKid] = {
        ...c, id: newKid, columnId: idMap[c.columnId],
        checklist: (c.checklist||[]).map(x => ({...x, id: uid("ch")})),
        created: now(), updated: now()
      };
    }
  });
  state.boards.push({
    id: newId, name: b.name + " (copy)",
    columnIds: newCols,
    doneColumnIds: (b.doneColumnIds||[]).map(c => idMap[c]).filter(Boolean),
    filter: {}, created: now()
  });
  state.activeBoardId = newId;
  logActivity(`Duplicated board <em>${esc(b.name)}</em>`);
  save();
  renderBoard();
}

function openBoardTabMenu(x, y, b) {
  const menu = document.createElement("div");
  menu.className = "popup-menu";
  menu.style.top = y + "px";
  menu.style.left = x + "px";
  menu.innerHTML = `
    <button data-act="rename">${svgIcon("edit",12)} Rename board</button>
    <button data-act="dup">${svgIcon("page",12)} Duplicate board</button>
    <div class="sep"></div>
    <button data-act="del" style="color:var(--danger)">${svgIcon("trash",12)} Delete board</button>
  `;
  document.body.appendChild(menu);
  // keep menu in viewport
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) menu.style.left = (window.innerWidth - r.width - 8) + "px";
    if (r.bottom > window.innerHeight - 8) menu.style.top = (window.innerHeight - r.height - 8) + "px";
  });
  const close = () => { menu.remove(); document.removeEventListener("click", outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("click", outside, true), 0);
  menu.querySelectorAll("button[data-act]").forEach(btn => btn.addEventListener("click", () => {
    const a = btn.dataset.act;
    if (a === "rename") renameBoard(b);
    else if (a === "dup") duplicateBoard(b);
    else if (a === "del") deleteBoard(b);
    close();
  }));
}

function openColumnMenu(btn, col, board) {
  const r = btn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "popup-menu";
  menu.style.top = (r.bottom + 4) + "px";
  menu.style.left = (r.right - 180) + "px";
  const colors = ["#737373", "#4f46e5", "#d97706", "#059669", "#dc2626", "#0ea5e9", "#a855f7", "#ec4899"];
  const swatchRow = colors.map(c => `<span class="swatch" data-c="${c}" style="background:${c};cursor:pointer;display:inline-block;width:16px;height:16px;margin:2px;border-radius:4px;${col.color===c?'outline:2px solid var(--accent)':''}"></span>`).join("");
  menu.innerHTML = `
    <button data-act="rename">${svgIcon("edit",12)} Rename</button>
    <div style="padding:6px 10px">
      <div style="font-size:10px;color:var(--text-subtle);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Color</div>
      ${swatchRow}
    </div>
    <div class="sep"></div>
    <button data-act="clear">${svgIcon("archive",12)} Archive all cards here</button>
    <button data-act="del" style="color:var(--danger)">${svgIcon("trash",12)} Delete column</button>
  `;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener("click", outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("click", outside, true), 0);
  menu.querySelectorAll(".swatch").forEach(s => s.addEventListener("click", () => {
    col.color = s.dataset.c; save(); renderBoard(); close();
  }));
  menu.querySelectorAll("button[data-act]").forEach(b => b.addEventListener("click", () => {
    const a = b.dataset.act;
    if (a === "rename") {
      const v = prompt("Column name", col.name);
      if (v && v.trim()) { col.name = v.trim(); save(); renderBoard(); }
    } else if (a === "clear") {
      cardsInColumn(col.id).forEach(c => { c.archived = true; c.updated = now(); });
      logActivity(`Archived all cards in <em>${esc(col.name)}</em>`);
      save(); renderBoard();
    } else if (a === "del") {
      if (board.columnIds.length <= 1) { toast("Need at least 1 column."); close(); return; }
      if (cardsInColumn(col.id, {showArchived: true}).length && !confirm(`Delete "${col.name}" and ${cardsInColumn(col.id, {showArchived: true}).length} cards in it?`)) { close(); return; }
      // remove cards
      Object.values(state.cards).filter(c => c.columnId === col.id).forEach(c => delete state.cards[c.id]);
      board.columnIds = board.columnIds.filter(id => id !== col.id);
      delete state.columns[col.id];
      logActivity(`Deleted column <em>${esc(col.name)}</em>`);
      save(); renderBoard();
    }
    close();
  }));
}

function openAssigneeFilter(anchor) {
  const r = anchor.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "popup-menu";
  menu.style.top = (r.bottom + 4) + "px";
  menu.style.left = r.left + "px";
  menu.style.minWidth = "240px";
  const board = activeBoard();
  const renderRows = () => {
    menu.innerHTML = `<button data-id="">${svgIcon("user",12)} All people</button>` +
      state.people.map(p => `
        <div class="person-row" data-id="${p.id}">
          <button class="person-pick" data-id="${p.id}">
            <span class="avatar" style="background:${p.color||pickAvatarColor(p.name)};width:14px;height:14px;font-size:8px;">${esc(p.initials||initials(p.name))}</span>
            <span class="person-name">${esc(p.name)}</span>
          </button>
          <button class="person-edit" data-act="rename" data-id="${p.id}" title="Rename">${svgIcon("edit",11)}</button>
          <button class="person-edit" data-act="del" data-id="${p.id}" title="Delete">${svgIcon("trash",11)}</button>
        </div>
      `).join("") +
      `<div class="sep"></div><button data-id="__new">${svgIcon("plus",12)} New person…</button>`;
    wire();
  };
  const wire = () => {
    menu.querySelectorAll("button[data-id]").forEach(b => b.addEventListener("click", (ev) => {
      const id = b.dataset.id;
      if (id === "__new") {
        const name = prompt("Person name");
        if (name && name.trim()) {
          const p = { id: uid("p"), name: name.trim(), initials: initials(name.trim()), color: pickAvatarColor(name.trim()) };
          state.people.push(p);
          logActivity(`Added person <em>${esc(p.name)}</em>`);
          save();
          board.filter.assignee = p.id;
          close();
          renderBoard();
        }
      } else if (b.classList.contains("person-pick") || (b.dataset.id === "" && b.parentElement === menu)) {
        board.filter.assignee = id || null;
        save();
        close();
        renderBoard();
      }
    }));
    menu.querySelectorAll(".person-edit").forEach(b => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = b.dataset.id;
      const p = state.people.find(x => x.id === id);
      if (!p) return;
      if (b.dataset.act === "rename") {
        const v = prompt("Rename person", p.name);
        if (v && v.trim()) {
          p.name = v.trim();
          p.initials = initials(p.name);
          logActivity(`Renamed person to <em>${esc(p.name)}</em>`);
          save();
          renderRows();
          renderBoard(); // refresh chips/avatars elsewhere
        }
      } else if (b.dataset.act === "del") {
        const refs = Object.values(state.cards).filter(c => c.assigneeId === id).length;
        const msg = refs
          ? `Delete "${p.name}"? They are assigned to ${refs} card${refs===1?"":"s"} — those cards will become unassigned.`
          : `Delete "${p.name}"?`;
        if (!confirm(msg)) return;
        Object.values(state.cards).forEach(c => { if (c.assigneeId === id) c.assigneeId = null; });
        state.boards.forEach(b => { if (b.filter && b.filter.assignee === id) b.filter.assignee = null; });
        state.people = state.people.filter(x => x.id !== id);
        logActivity(`Deleted person <em>${esc(p.name)}</em>`);
        save();
        renderRows();
        renderBoard();
      }
    }));
  };
  document.body.appendChild(menu);
  renderRows();
  const close = () => { menu.remove(); document.removeEventListener("click", outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("click", outside, true), 0);
}

function openTagFilter(anchor) {
  const r = anchor.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "popup-menu";
  menu.style.top = (r.bottom + 4) + "px";
  menu.style.left = r.left + "px";
  const board = activeBoard();
  // collect all tags across cards + state.tags
  const all = new Set(state.tags || []);
  Object.values(state.cards).forEach(c => (c.tags||[]).forEach(t => all.add(t)));
  menu.innerHTML = `<button data-tag="">${svgIcon("tag",12)} All tags</button>` +
    [...all].sort().map(t => `<button data-tag="${esc(t)}">${svgIcon("tag",12)} ${esc(t)}</button>`).join("");
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener("click", outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("click", outside, true), 0);
  menu.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    board.filter.tag = b.dataset.tag || null;
    save(); renderBoard(); close();
  }));
}

// ---------- Card Modal ----------
let currentModalCardId = null;
function openCardModal(cardId, focusTitle = false) {
  const c = state.cards[cardId];
  if (!c) return;
  currentModalCardId = cardId;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "card-modal";

  const board = activeBoard();
  const colOptions = board.columnIds.map(id => {
    const col = state.columns[id];
    return `<option value="${id}" ${id===c.columnId?"selected":""}>${esc(col.name)}</option>`;
  }).join("");

  const peopleOptions = `<option value="">Unassigned</option>` + state.people.map(p =>
    `<option value="${p.id}" ${p.id===c.assigneeId?"selected":""}>${esc(p.name)}</option>`
  ).join("") + `<option value="__new">+ New person…</option>`;

  const wikiOptions = `<option value="">— None —</option>` + Object.values(state.wiki.pages).map(p =>
    `<option value="${p.id}" ${p.id===c.linkedWikiId?"selected":""}>${esc(p.title)}</option>`
  ).join("");

  const colName = state.columns[c.columnId]?.name || "";

  backdrop.innerHTML = `
    <div class="modal" role="dialog">
      <div class="modal-head">
        <div style="flex:1">
          <div class="col-label">${esc(colName)}</div>
          <input class="title-input" value="${esc(c.title)}" data-f="title" placeholder="Card title">
        </div>
        <button class="close" data-act="close">${svgIcon("x",16)}</button>
      </div>
      <div class="modal-body">
        <div class="left">
          <div>
            <div class="field-label">Description</div>
            <textarea data-f="description" placeholder="Add a description (Markdown supported)">${esc(c.description||"")}</textarea>
          </div>
          <div>
            <div class="field-label">Checklist</div>
            <div class="checklist" id="checklist"></div>
            <button class="add-check" data-act="add-check">+ Add item</button>
          </div>
        </div>
        <div class="right">
          <div>
            <div class="field-label">Column</div>
            <select data-f="column">${colOptions}</select>
          </div>
          <div>
            <div class="field-label">Priority</div>
            <div class="priority-pick">
              ${["None","Low","Med","High"].map(p => `<button data-p="${p}" class="${c.priority===p?"active":""}">${p}</button>`).join("")}
            </div>
          </div>
          <div>
            <div class="field-label">Assignee</div>
            <select data-f="assignee">${peopleOptions}</select>
          </div>
          <div>
            <div class="field-label">Due date</div>
            <input type="date" data-f="due" value="${c.due ? c.due.slice(0,10) : ""}">
          </div>
          <div>
            <div class="field-label">Tags</div>
            <div class="tag-input" id="tag-input"></div>
          </div>
          <div>
            <div class="field-label">Linked wiki page</div>
            <select data-f="wiki">${wikiOptions}</select>
          </div>
          <div>
            <div class="field-label">&nbsp;</div>
            <button class="ghost" data-act="archive">${c.archived ? svgIcon("undo",12)+" Unarchive" : svgIcon("archive",12)+" Archive"}</button>
            <button class="danger" data-act="delete" style="margin-top:6px;">${svgIcon("trash",12)} Delete card</button>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <div class="timestamps">Created ${relTime(c.created)} · Updated ${relTime(c.updated)}</div>
        <button class="primary" data-act="done">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  // Helpers
  const $ = sel => backdrop.querySelector(sel);
  const $$ = sel => backdrop.querySelectorAll(sel);

  function close() {
    backdrop.remove();
    currentModalCardId = null;
    // Re-render whichever view is currently visible so deletes/edits show up
    if (state.activeView === "schedule") renderSchedule();
    else if (state.activeView === "wiki") renderWiki();
    else renderBoard();
  }

  backdrop.addEventListener("click", e => {
    if (e.target === backdrop) close();
  });
  $("[data-act=close]").addEventListener("click", close);
  $("[data-act=done]").addEventListener("click", close);

  // Field updates
  function update(field, value) {
    c[field === "column" ? "columnId" :
      field === "assignee" ? "assigneeId" :
      field === "wiki" ? "linkedWikiId" :
      field] = value;
    c.updated = now();
    save();
  }

  $("[data-f=title]").addEventListener("input", e => { c.title = e.target.value; c.updated = now(); save(); });
  $("[data-f=description]").addEventListener("input", e => { c.description = e.target.value; c.updated = now(); save(); });
  $("[data-f=column]").addEventListener("change", e => { update("columnId", e.target.value); });
  $("[data-f=due]").addEventListener("change", e => { update("due", e.target.value || null); });
  $("[data-f=wiki]").addEventListener("change", e => { update("linkedWikiId", e.target.value || null); });
  $("[data-f=assignee]").addEventListener("change", e => {
    if (e.target.value === "__new") {
      const name = prompt("Person name");
      if (name && name.trim()) {
        const p = { id: uid("p"), name: name.trim(), initials: initials(name.trim()), color: pickAvatarColor(name.trim()) };
        state.people.push(p);
        c.assigneeId = p.id;
      }
    } else {
      c.assigneeId = e.target.value || null;
    }
    c.updated = now();
    save();
    // rebuild select to include new person
    const sel = $("[data-f=assignee]");
    sel.innerHTML = `<option value="">Unassigned</option>` + state.people.map(p =>
      `<option value="${p.id}" ${p.id===c.assigneeId?"selected":""}>${esc(p.name)}</option>`
    ).join("") + `<option value="__new">+ New person…</option>`;
  });
  $$(".priority-pick button").forEach(b => b.addEventListener("click", () => {
    c.priority = b.dataset.p; c.updated = now(); save();
    $$(".priority-pick button").forEach(x => x.classList.toggle("active", x.dataset.p === c.priority));
  }));
  $("[data-act=archive]").addEventListener("click", () => {
    c.archived = !c.archived;
    c.updated = now();
    logActivity(`${c.archived ? "Archived" : "Unarchived"} <b>${esc(c.title)}</b>`);
    save();
    close();
  });
  $("[data-act=delete]").addEventListener("click", () => {
    if (!confirm("Delete this card?")) return;
    logActivity(`Deleted <b>${esc(c.title)}</b>`);
    // Remove from column's cardIds list
    const col = state.columns[c.columnId];
    if (col && col.cardIds) col.cardIds = col.cardIds.filter(id => id !== cardId);
    delete state.cards[cardId];
    save();
    close();
  });

  // Checklist
  function renderChecklist() {
    const wrap = $("#checklist");
    wrap.innerHTML = "";
    (c.checklist || []).forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "check-item";
      row.innerHTML = `
        <input type="checkbox" ${item.done?"checked":""}>
        <div class="text ${item.done?"done":""}" contenteditable="true" spellcheck="false">${esc(item.text)}</div>
        <button class="rm" title="Remove">${svgIcon("x",12)}</button>
      `;
      row.querySelector("input").addEventListener("change", e => {
        item.done = e.target.checked;
        c.updated = now();
        save();
        row.querySelector(".text").classList.toggle("done", item.done);
      });
      const txt = row.querySelector(".text");
      txt.addEventListener("blur", () => {
        item.text = txt.textContent.trim();
        c.updated = now();
        save();
      });
      txt.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); txt.blur(); }
      });
      row.querySelector(".rm").addEventListener("click", () => {
        c.checklist.splice(idx, 1);
        c.updated = now();
        save();
        renderChecklist();
      });
      wrap.appendChild(row);
    });
  }
  renderChecklist();
  $("[data-act=add-check]").addEventListener("click", () => {
    c.checklist = c.checklist || [];
    c.checklist.push({ id: uid("ch"), text: "New item", done: false });
    c.updated = now();
    save();
    renderChecklist();
    // focus new
    const items = $$("#checklist .check-item");
    const last = items[items.length-1];
    if (last) {
      const t = last.querySelector(".text");
      t.focus();
      const range = document.createRange();
      range.selectNodeContents(t);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
    }
  });

  // Tag input
  function renderTags() {
    const wrap = $("#tag-input");
    wrap.innerHTML = "";
    (c.tags||[]).forEach((t, idx) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.innerHTML = `${esc(t)} <span class="x" title="Remove">×</span>`;
      tag.querySelector(".x").addEventListener("click", () => {
        c.tags.splice(idx, 1);
        c.updated = now();
        save();
        renderTags();
      });
      wrap.appendChild(tag);
    });
    const input = document.createElement("input");
    input.placeholder = (c.tags||[]).length ? "" : "Add tag…";
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const v = input.value.trim().replace(/,$/, "");
        if (v) {
          c.tags = c.tags || [];
          if (!c.tags.includes(v)) c.tags.push(v);
          if (!state.tags.includes(v)) state.tags.push(v);
          c.updated = now();
          save();
          renderTags();
        }
      } else if (e.key === "Backspace" && !input.value && c.tags && c.tags.length) {
        c.tags.pop(); save(); renderTags();
      }
    });
    wrap.appendChild(input);
    if (focusTitle === "tags") input.focus();
  }
  renderTags();

  if (focusTitle) {
    const ti = $("[data-f=title]");
    ti.focus(); ti.select();
  }
}

// ---------- Wiki ----------
let activeWikiMode = "split"; // 'split' | 'preview' | 'edit'

function renderWiki() {
  // Sidebar
  const sb = document.getElementById("wiki-tree");
  sb.innerHTML = "";
  const order = state.wiki.rootOrder.filter(id => state.wiki.pages[id]);
  // include orphans not in rootOrder
  Object.values(state.wiki.pages).forEach(p => {
    if (!p.parentId && !order.includes(p.id)) order.push(p.id);
  });
  order.forEach(id => sb.appendChild(renderWikiNode(id, 0)));

  // Tags sidebar
  const tagsHost = document.getElementById("wiki-tags-list");
  const allTags = new Set();
  Object.values(state.wiki.pages).forEach(p => (p.tags||[]).forEach(t => allTags.add(t)));
  tagsHost.innerHTML = "";
  if (allTags.size === 0) {
    tagsHost.innerHTML = `<span style="font-size:11px;color:var(--text-subtle);">No tags yet</span>`;
  } else {
    [...allTags].sort().forEach(t => {
      const el = document.createElement("span");
      el.className = "tag" + (wikiTagFilter === t ? " active" : "");
      el.textContent = t;
      el.addEventListener("click", () => {
        wikiTagFilter = wikiTagFilter === t ? null : t;
        renderWiki();
      });
      tagsHost.appendChild(el);
    });
  }

  // Pick a page to show
  const pageId = state.activeWikiPageId || order[0] || null;
  state.activeWikiPageId = pageId;
  renderWikiContent(pageId);
}

let wikiTagFilter = null;

function renderWikiNode(id, depth) {
  const page = state.wiki.pages[id];
  if (!page) return document.createComment("missing");
  // tag filter: only show pages whose subtree contains the tag
  if (wikiTagFilter && !subtreeHasTag(id, wikiTagFilter)) {
    return document.createComment("filtered");
  }

  const children = Object.values(state.wiki.pages).filter(p => p.parentId === id).map(p => p.id);
  const expanded = !!state.wiki.expanded[id];

  const wrap = document.createElement("div");
  const node = document.createElement("div");
  node.className = "tree-node" + (state.activeWikiPageId === id ? " active" : "");
  node.draggable = true;
  node.dataset.pageId = id;
  node.innerHTML = `
    <span class="chev ${children.length ? (expanded?"open":"") : "placeholder"}">${svgIcon("chev",10)}</span>
    <span class="icon">${svgIcon(children.length?"folder":"page", 12)}</span>
    <span class="label">${esc(page.title || "Untitled")}</span>
    <button class="add-child" title="New child page">${svgIcon("plus",10)}</button>
  `;
  node.querySelector(".chev").addEventListener("click", e => {
    e.stopPropagation();
    if (!children.length) return;
    state.wiki.expanded[id] = !state.wiki.expanded[id];
    save();
    renderWiki();
  });
  node.addEventListener("click", () => {
    state.activeWikiPageId = id;
    state.wiki.expanded[id] = state.wiki.expanded[id] || children.length > 0;
    save();
    renderWiki();
  });
  node.querySelector(".add-child").addEventListener("click", e => {
    e.stopPropagation();
    const p = createPage(id);
    state.wiki.expanded[id] = true;
    state.activeWikiPageId = p.id;
    save();
    renderWiki();
  });

  // Context menu (right-click)
  node.addEventListener("contextmenu", e => {
    e.preventDefault();
    openWikiNodeMenu(e.clientX, e.clientY, page);
  });

  // Drag & drop in tree
  node.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/wikiid", id);
    e.dataTransfer.effectAllowed = "move";
  });
  node.addEventListener("dragover", e => {
    e.preventDefault();
    node.classList.add("drop-target");
  });
  node.addEventListener("dragleave", () => node.classList.remove("drop-target"));
  node.addEventListener("drop", e => {
    e.preventDefault();
    node.classList.remove("drop-target");
    const srcId = e.dataTransfer.getData("text/wikiid");
    if (!srcId || srcId === id) return;
    // Prevent drop into descendant
    if (isAncestor(srcId, id)) { toast("Can't move a page into its own descendant.", "warn"); return; }
    const src = state.wiki.pages[srcId];
    src.parentId = id;
    state.wiki.expanded[id] = true;
    // remove from rootOrder if present
    state.wiki.rootOrder = state.wiki.rootOrder.filter(x => x !== srcId);
    save();
    renderWiki();
  });

  wrap.appendChild(node);

  if (expanded && children.length) {
    const kidsWrap = document.createElement("div");
    kidsWrap.className = "tree-children";
    children.forEach(cid => kidsWrap.appendChild(renderWikiNode(cid, depth+1)));
    wrap.appendChild(kidsWrap);
  }
  return wrap;
}

function subtreeHasTag(id, tag) {
  const p = state.wiki.pages[id]; if (!p) return false;
  if ((p.tags||[]).includes(tag)) return true;
  return Object.values(state.wiki.pages).some(c => c.parentId === id && subtreeHasTag(c.id, tag));
}
function isAncestor(ancestorId, candidateId) {
  let cur = state.wiki.pages[candidateId];
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = state.wiki.pages[cur.parentId];
  }
  return false;
}

function createPage(parentId = null) {
  const id = uid("w");
  state.wiki.pages[id] = {
    id, parentId, title: "Untitled",
    tags: [], body: "", created: now(), updated: now()
  };
  if (!parentId) state.wiki.rootOrder.push(id);
  logActivity(`Created wiki page <em>Untitled</em>`);
  save();
  return state.wiki.pages[id];
}

function openWikiNodeMenu(x, y, page) {
  const menu = document.createElement("div");
  menu.className = "popup-menu";
  menu.style.top = y + "px"; menu.style.left = x + "px";
  menu.innerHTML = `
    <button data-act="new-child">${svgIcon("plus",12)} New child page</button>
    <button data-act="new-sibling">${svgIcon("plus",12)} New sibling</button>
    <button data-act="rename">${svgIcon("edit",12)} Rename</button>
    <button data-act="move-root">${svgIcon("home",12)} Move to top level</button>
    <div class="sep"></div>
    <button data-act="del" style="color:var(--danger)">${svgIcon("trash",12)} Delete page</button>
  `;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener("click", outside, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener("click", outside, true), 0);
  menu.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const a = b.dataset.act;
    if (a === "new-child") {
      const p = createPage(page.id); state.wiki.expanded[page.id] = true; state.activeWikiPageId = p.id;
    } else if (a === "new-sibling") {
      const p = createPage(page.parentId); state.activeWikiPageId = p.id;
    } else if (a === "rename") {
      const v = prompt("Page title", page.title);
      if (v && v.trim()) { page.title = v.trim(); page.updated = now(); }
    } else if (a === "move-root") {
      page.parentId = null;
      if (!state.wiki.rootOrder.includes(page.id)) state.wiki.rootOrder.push(page.id);
    } else if (a === "del") {
      if (!confirm(`Delete "${page.title}" and all child pages?`)) { close(); return; }
      deletePageRec(page.id);
      state.activeWikiPageId = state.wiki.rootOrder.find(id => state.wiki.pages[id]) || null;
    }
    save();
    renderWiki();
    close();
  }));
}

function deletePageRec(id) {
  Object.values(state.wiki.pages).filter(p => p.parentId === id).forEach(c => deletePageRec(c.id));
  delete state.wiki.pages[id];
  state.wiki.rootOrder = state.wiki.rootOrder.filter(x => x !== id);
  delete state.wiki.expanded[id];
  // unlink cards
  Object.values(state.cards).forEach(c => { if (c.linkedWikiId === id) c.linkedWikiId = null; });
}

function renderWikiContent(pageId) {
  const main = document.getElementById("wiki-content");
  const tb = document.getElementById("wiki-breadcrumb");
  const modeT = document.getElementById("wiki-mode-toggle");
  if (!pageId) {
    main.innerHTML = `<div class="empty"><h2>No page selected</h2><p>Create a page from the sidebar to get started.</p><button class="primary" id="new-root-page">${svgIcon("plus",12)} New page</button></div>`;
    tb.innerHTML = "";
    modeT.style.visibility = "hidden";
    const b = document.getElementById("new-root-page");
    if (b) b.addEventListener("click", () => { const p = createPage(null); state.activeWikiPageId = p.id; save(); renderWiki(); });
    return;
  }
  modeT.style.visibility = "visible";
  const page = state.wiki.pages[pageId];
  if (!page) return;

  // Breadcrumb
  const trail = [];
  let cur = page;
  while (cur) {
    trail.unshift(cur);
    cur = cur.parentId ? state.wiki.pages[cur.parentId] : null;
  }
  tb.innerHTML = trail.map((p, i) => {
    const cls = i === trail.length-1 ? "last" : "";
    return `<span class="${cls}" data-id="${p.id}" style="cursor:${cls?'default':'pointer'}">${esc(p.title || "Untitled")}</span>` +
           (i < trail.length-1 ? `<span class="sep">›</span>` : "");
  }).join("");
  tb.querySelectorAll("span[data-id]:not(.last)").forEach(el => el.addEventListener("click", () => {
    state.activeWikiPageId = el.dataset.id; save(); renderWiki();
  }));

  // Mode toggle
  modeT.querySelectorAll("button").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === activeWikiMode);
    b.onclick = () => { activeWikiMode = b.dataset.mode; renderWikiContent(pageId); };
  });

  const editorToolbar = `
    <div class="wiki-editor-toolbar">
      <button data-md="bold" title="Bold (wrap selection)"><b>B</b></button>
      <button data-md="italic" title="Italic"><i>I</i></button>
      <button data-md="h2" title="Heading">H</button>
      <button data-md="code" title="Code">&lt;/&gt;</button>
      <button data-md="link" title="Link">${svgIcon("link", 11)}</button>
      <button data-md="list" title="Bulleted list">•</button>
      <button data-md="task" title="Task list">☐</button>
      <div class="sep"></div>
      <button data-act="insert-image" title="Insert image (or paste / drop one)">${svgIcon("image", 11)} Image</button>
      <button data-act="insert-wikilink" title="Link another wiki page">${svgIcon("book", 11)} Wiki link</button>
      <span class="hint">Tip: paste or drop an image directly</span>
    </div>`;
  const splitMarkup = `
    <div class="wiki-pane fullwidth">
      <input class="page-title" value="${esc(page.title)}">
      <input class="page-tags-input" placeholder="Add tags (comma-separated)" value="${esc((page.tags||[]).join(", "))}">
      <div class="split">
        <div class="editor-col">
          ${editorToolbar}
          <textarea class="md-editor" placeholder="Write in Markdown… ([[Other Page]] to link, paste images to embed)">${esc(page.body||"")}</textarea>
        </div>
        <div class="md-rendered">${window.mdRender(page.body||"")}</div>
      </div>
    </div>`;
  const editMarkup = `
    <div class="wiki-pane fullwidth">
      <input class="page-title" value="${esc(page.title)}">
      <input class="page-tags-input" placeholder="Add tags (comma-separated)" value="${esc((page.tags||[]).join(", "))}">
      <div class="edit-only">
        ${editorToolbar}
        <textarea class="md-editor" placeholder="Write in Markdown…">${esc(page.body||"")}</textarea>
      </div>
    </div>`;
  const previewMarkup = `
    <div class="wiki-pane fullwidth">
      <h1 style="margin-top:0;font-family:var(--font-head);font-size:28px;letter-spacing:-0.01em;">${esc(page.title)}</h1>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:18px;">
        ${(page.tags||[]).map(t => `<span class="tag" style="margin-right:4px;">${esc(t)}</span>`).join("") || `<span style="color:var(--text-subtle)">No tags · last edited ${relTime(page.updated)}</span>`}
      </div>
      <div class="md-rendered preview-only">${window.mdRender(page.body||"")}</div>
    </div>`;

  main.innerHTML = activeWikiMode === "split" ? splitMarkup : activeWikiMode === "edit" ? editMarkup : previewMarkup;

  // Wire up fields
  const titleEl = main.querySelector(".page-title");
  const tagsEl = main.querySelector(".page-tags-input");
  const editorEl = main.querySelector(".md-editor");
  const renderedEl = main.querySelector(".split .md-rendered");

  if (titleEl) titleEl.addEventListener("input", () => {
    page.title = titleEl.value.trim() || "Untitled";
    page.updated = now();
    save();
    // refresh sidebar label
    const sb = document.getElementById("wiki-tree");
    const n = sb.querySelector(`.tree-node[data-page-id="${page.id}"] .label`);
    if (n) n.textContent = page.title;
    // refresh breadcrumb last
    const last = tb.querySelector(".last"); if (last) last.textContent = page.title;
  });
  if (tagsEl) tagsEl.addEventListener("input", () => {
    page.tags = tagsEl.value.split(",").map(s => s.trim()).filter(Boolean);
    page.updated = now();
    save();
  });
  if (editorEl) {
    editorEl.addEventListener("input", () => {
      page.body = editorEl.value;
      page.updated = now();
      save();
      if (renderedEl) renderedEl.innerHTML = window.mdRender(page.body);
    });
    wireEditorTools(editorEl, page, renderedEl, main);
  }
  // wiki-link clicks
  main.querySelectorAll("a[data-wikilink]").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      const name = a.dataset.wikilink;
      const target = Object.values(state.wiki.pages).find(p => p.title.toLowerCase() === name.toLowerCase());
      if (target) { state.activeWikiPageId = target.id; save(); renderWiki(); }
      else if (confirm(`Create page "${name}"?`)) {
        const p = createPage(null);
        p.title = name;
        state.activeWikiPageId = p.id;
        save();
        renderWiki();
      }
    });
  });
}

function syncEditor(editor, page, renderedEl) {
  page.body = editor.value;
  page.updated = now();
  save();
  if (renderedEl) renderedEl.innerHTML = window.mdRender(page.body);
}

function insertAtCursor(editor, text, selectInserted = false) {
  const s = editor.selectionStart;
  const e = editor.selectionEnd;
  const before = editor.value.slice(0, s);
  const after = editor.value.slice(e);
  editor.value = before + text + after;
  if (selectInserted) {
    editor.selectionStart = s;
    editor.selectionEnd = s + text.length;
  } else {
    editor.selectionStart = editor.selectionEnd = s + text.length;
  }
  editor.focus();
}

function wrapSelection(editor, before, after, placeholder = "") {
  const s = editor.selectionStart;
  const e = editor.selectionEnd;
  const sel = editor.value.slice(s, e) || placeholder;
  const insert = before + sel + after;
  editor.value = editor.value.slice(0, s) + insert + editor.value.slice(e);
  editor.selectionStart = s + before.length;
  editor.selectionEnd = s + before.length + sel.length;
  editor.focus();
}

function insertImageFromFile(file, editor, page, renderedEl) {
  if (!file || !file.type.startsWith("image/")) {
    toast("That's not an image file.", "warn");
    return;
  }
  const sizeMb = file.size / (1024*1024);
  if (sizeMb > 5) {
    if (!confirm(`This image is ${sizeMb.toFixed(1)} MB. Large images bloat your JSON export. Continue?`)) return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const altText = file.name.replace(/\.[^.]+$/, "") || "image";
    const md = `\n\n![${altText}](${dataUrl})\n\n`;
    insertAtCursor(editor, md);
    syncEditor(editor, page, renderedEl);
    toast("Image inserted ✓", "ok");
  };
  reader.onerror = () => toast("Couldn't read image.", "warn");
  reader.readAsDataURL(file);
}

function wireEditorTools(editor, page, renderedEl, main) {
  // Toolbar buttons
  main.querySelectorAll(".wiki-editor-toolbar button[data-md]").forEach(b => {
    b.addEventListener("click", () => {
      const kind = b.dataset.md;
      if (kind === "bold")        wrapSelection(editor, "**", "**", "bold text");
      else if (kind === "italic") wrapSelection(editor, "*", "*", "italic text");
      else if (kind === "h2")     { wrapSelection(editor, "\n## ", "\n", "Heading"); }
      else if (kind === "code")   wrapSelection(editor, "`", "`", "code");
      else if (kind === "link")   wrapSelection(editor, "[", "](https://)", "link text");
      else if (kind === "list")   wrapSelection(editor, "\n- ", "\n", "item");
      else if (kind === "task")   wrapSelection(editor, "\n- [ ] ", "\n", "task");
      syncEditor(editor, page, renderedEl);
    });
  });
  // Insert image button
  const imgBtn = main.querySelector('[data-act="insert-image"]');
  if (imgBtn) imgBtn.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.addEventListener("change", () => {
      [...input.files].forEach(f => insertImageFromFile(f, editor, page, renderedEl));
    });
    input.click();
  });
  // Wiki-link button
  const wlBtn = main.querySelector('[data-act="insert-wikilink"]');
  if (wlBtn) wlBtn.addEventListener("click", () => {
    const pages = Object.values(state.wiki.pages).filter(p => p.id !== page.id);
    if (!pages.length) { toast("Create another page first.", "warn"); return; }
    const title = prompt("Page to link to:\n" + pages.map(p => "• " + p.title).join("\n"));
    if (!title || !title.trim()) return;
    insertAtCursor(editor, `[[${title.trim()}]]`);
    syncEditor(editor, page, renderedEl);
  });

  // Paste image from clipboard
  editor.addEventListener("paste", (e) => {
    const items = (e.clipboardData || {}).items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          insertImageFromFile(file, editor, page, renderedEl);
          return;
        }
      }
    }
  });

  // Drag & drop image onto editor
  editor.addEventListener("dragover", (e) => {
    const hasFiles = [...(e.dataTransfer?.types || [])].includes("Files");
    if (hasFiles) {
      e.preventDefault();
      e.stopPropagation();
      editor.classList.add("drop-target");
    }
  });
  editor.addEventListener("dragleave", () => editor.classList.remove("drop-target"));
  editor.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    const imgs = files.filter(f => f.type.startsWith("image/"));
    if (imgs.length) {
      e.preventDefault();
      e.stopPropagation();
      editor.classList.remove("drop-target");
      imgs.forEach(f => insertImageFromFile(f, editor, page, renderedEl));
    }
  });
}

// ---------- Schedule View ----------
const PERIOD_COLORS = ["#4f46e5", "#0ea5e9", "#059669", "#d97706", "#dc2626", "#a855f7", "#ec4899", "#737373"];

function ensureScheduleState() {
  if (!state.scheduleView) {
    state.scheduleView = {
      span: "month",
      anchor: new Date().toISOString().slice(0, 10),
      boardFilter: "all"
    };
  }
  if (!state.periods) state.periods = [];
}

function dayStart(d) {
  const x = (d instanceof Date) ? new Date(d.getTime()) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}
function isoDate(d) {
  const x = (d instanceof Date) ? d : new Date(d);
  const yy = x.getFullYear();
  const mm = String(x.getMonth()+1).padStart(2,"0");
  const dd = String(x.getDate()).padStart(2,"0");
  return `${yy}-${mm}-${dd}`;
}

function getSpanRange() {
  ensureScheduleState();
  const sv = state.scheduleView;
  const a = dayStart(new Date(sv.anchor + "T12:00:00"));
  let start, end, label;
  if (sv.span === "week") {
    const dow = (a.getDay() + 6) % 7; // 0=Mon
    start = addDays(a, -dow);
    end = addDays(start, 7);
    label = `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  } else if (sv.span === "month") {
    start = new Date(a.getFullYear(), a.getMonth(), 1);
    end = new Date(a.getFullYear(), a.getMonth()+1, 1);
    label = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } else if (sv.span === "quarter") {
    const q0 = Math.floor(a.getMonth() / 3) * 3;
    start = new Date(a.getFullYear(), q0, 1);
    end = new Date(a.getFullYear(), q0 + 3, 1);
    label = `Q${q0/3 + 1} ${start.getFullYear()}`;
  } else if (sv.span === "custom" && sv.customStart && sv.customEnd) {
    start = dayStart(new Date(sv.customStart + "T12:00:00"));
    // inclusive end → +1 day for exclusive bound
    end = addDays(dayStart(new Date(sv.customEnd + "T12:00:00")), 1);
    const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    label = `${fmt(start)} → ${fmt(addDays(end, -1))}`;
  } else {
    start = new Date(a.getFullYear(), 0, 1);
    end = new Date(a.getFullYear()+1, 0, 1);
    label = String(start.getFullYear());
  }
  return { start: dayStart(start), end: dayStart(end), label };
}

function stepAnchor(dir) {
  ensureScheduleState();
  const sv = state.scheduleView;
  if (sv.span === "custom" && sv.customStart && sv.customEnd) {
    // shift the custom range by its own length
    const s = dayStart(new Date(sv.customStart + "T12:00:00"));
    const e = dayStart(new Date(sv.customEnd + "T12:00:00"));
    const span = Math.max(1, Math.round((e - s) / 86400000) + 1);
    sv.customStart = isoDate(addDays(s, span * dir));
    sv.customEnd = isoDate(addDays(e, span * dir));
    sv.anchor = sv.customStart;
    save();
    return;
  }
  const a = new Date(sv.anchor + "T12:00:00");
  if (sv.span === "week") a.setDate(a.getDate() + 7*dir);
  else if (sv.span === "month") a.setMonth(a.getMonth() + dir);
  else if (sv.span === "quarter") a.setMonth(a.getMonth() + 3*dir);
  else a.setFullYear(a.getFullYear() + dir);
  sv.anchor = isoDate(a);
  save();
}

function openCustomRangePopover(anchor) {
  ensureScheduleState();
  const sv = state.scheduleView;
  // Close existing
  document.querySelectorAll(".custom-range-pop").forEach(p => p.remove());

  // Sensible defaults
  const today = new Date();
  const defaultStart = sv.customStart || isoDate(today);
  const defaultEnd = sv.customEnd || isoDate(addDays(today, 30));

  const r = anchor.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "popup-menu custom-range-pop";
  pop.style.top = (r.bottom + 6) + "px";
  pop.style.left = Math.min(r.left, window.innerWidth - 280) + "px";
  pop.style.minWidth = "260px";
  pop.style.padding = "12px";
  pop.innerHTML = `
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-subtle);margin-bottom:6px;">Custom range</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;font-size:12px;">
      <label>Start</label><input type="date" id="cr-start" value="${defaultStart}">
      <label>End</label><input type="date" id="cr-end" value="${defaultEnd}">
    </div>
    <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;">
      <button class="ghost" data-preset="7">Next 7d</button>
      <button class="ghost" data-preset="30">Next 30d</button>
      <button class="ghost" data-preset="90">Next 90d</button>
      <button class="ghost" data-preset="-30">Last 30d</button>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px;">
      <button class="ghost" data-act="cancel">Cancel</button>
      <button class="primary" data-act="apply">Apply</button>
    </div>
  `;
  document.body.appendChild(pop);

  const startInp = pop.querySelector("#cr-start");
  const endInp = pop.querySelector("#cr-end");

  const close = () => { pop.remove(); document.removeEventListener("mousedown", outside, true); };
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener("mousedown", outside, true), 0);

  pop.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => {
    const n = parseInt(b.dataset.preset, 10);
    const today = new Date();
    if (n >= 0) {
      startInp.value = isoDate(today);
      endInp.value = isoDate(addDays(today, n));
    } else {
      startInp.value = isoDate(addDays(today, n));
      endInp.value = isoDate(today);
    }
  }));

  pop.querySelector("[data-act=cancel]").addEventListener("click", close);
  pop.querySelector("[data-act=apply]").addEventListener("click", () => {
    const s = startInp.value, e = endInp.value;
    if (!s || !e) { toast("Pick both dates.", "warn"); return; }
    if (new Date(e) < new Date(s)) { toast("End must be after start.", "warn"); return; }
    sv.customStart = s;
    sv.customEnd = e;
    sv.span = "custom";
    sv.anchor = s;
    save();
    close();
    renderSchedule();
  });

  setTimeout(() => startInp.focus(), 0);
}

function renderSchedule() {
  ensureScheduleState();
  const sv = state.scheduleView;

  // Span tabs
  document.querySelectorAll("#sched-span-tabs button").forEach(b => {
    b.classList.toggle("active", b.dataset.span === sv.span);
    if (b.dataset.span === "custom") {
      // Update label to show the active range
      if (sv.span === "custom" && sv.customStart && sv.customEnd) {
        const s = new Date(sv.customStart + "T12:00:00");
        const e = new Date(sv.customEnd + "T12:00:00");
        const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        b.textContent = `${fmt(s)} – ${fmt(e)}`;
      } else {
        b.textContent = "Custom…";
      }
    }
    b.onclick = () => {
      if (b.dataset.span === "custom") {
        openCustomRangePopover(b);
      } else {
        sv.span = b.dataset.span;
        save();
        renderSchedule();
      }
    };
  });
  document.getElementById("sched-prev").onclick = () => { stepAnchor(-1); renderSchedule(); };
  document.getElementById("sched-next").onclick = () => { stepAnchor(1); renderSchedule(); };
  document.getElementById("sched-today").onclick = () => { sv.anchor = isoDate(new Date()); save(); renderSchedule(); };
  document.getElementById("sched-new-period").onclick = () => openPeriodDialog(null);

  // Board filter
  const sel = document.getElementById("sched-board-filter");
  sel.innerHTML = `<option value="all">All boards</option>` +
    state.boards.map(b => `<option value="${b.id}" ${b.id===sv.boardFilter?"selected":""}>${esc(b.name)}</option>`).join("");
  sel.onchange = () => { sv.boardFilter = sel.value; save(); renderSchedule(); };

  const { start, end, label } = getSpanRange();
  document.getElementById("sched-current").textContent = label;

  const dayMs = 86400000;
  const totalDays = Math.round((end - start) / dayMs);
  // Compute day width based on canvas width and span density
  const canvas = document.getElementById("sched-canvas");
  const canvasW = canvas.clientWidth;
  const labelW = 220;
  const availW = Math.max(canvasW - labelW, 400);
  let dayWidth;
  if (sv.span === "week")       dayWidth = Math.max(60, availW / totalDays);
  else if (sv.span === "month") dayWidth = Math.max(28, availW / totalDays);
  else if (sv.span === "quarter") dayWidth = Math.max(10, availW / totalDays);
  else                          dayWidth = Math.max(4, availW / totalDays);

  const gridW = totalDays * dayWidth;

  function xFor(d) {
    return ((dayStart(d) - start) / dayMs) * dayWidth;
  }
  function xRange(d) {
    // For ranges, treat the END date as inclusive — extend by one day
    return ((dayStart(d) - start) / dayMs + 1) * dayWidth;
  }

  // Collect tasks
  const boards = sv.boardFilter === "all" ? state.boards : state.boards.filter(b => b.id === sv.boardFilter);
  const colIds = new Set();
  boards.forEach(b => b.columnIds.forEach(c => colIds.add(c)));
  const cards = Object.values(state.cards).filter(c => !c.archived && colIds.has(c.columnId));
  // Two groups: with due date, without
  const dated = cards.filter(c => c.due).sort((a,b) => new Date(a.due) - new Date(b.due));
  const undated = cards.filter(c => !c.due);

  const periods = (state.periods || []).slice().sort((a,b) => new Date(a.start) - new Date(b.start));

  // Build day headers HTML
  let daysHtml = "";
  const today = dayStart(new Date());
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(start, i);
    const dow = d.getDay();
    const isWeekend = (dow === 0 || dow === 6);
    const isToday = d.getTime() === today.getTime();
    const isMonthStart = d.getDate() === 1 && i > 0;
    let label;
    if (sv.span === "year") {
      label = d.getDate() === 1 ? `<span class="dnum">${d.toLocaleDateString(undefined,{month:"short"})}</span>` : "";
    } else if (sv.span === "quarter") {
      label = d.getDay() === 1 ? `<span class="dnum">${d.getDate()}</span>` : "";
    } else if (sv.span === "month") {
      label = `<span class="dnum">${d.getDate()}</span><span class="dname">${d.toLocaleDateString(undefined,{weekday:"narrow"})}</span>`;
    } else {
      label = `<span class="dname">${d.toLocaleDateString(undefined,{weekday:"short"})}</span><span class="dnum">${d.getDate()}</span>`;
    }
    daysHtml += `<div class="sched-day ${isWeekend?"weekend":""} ${isToday?"today":""} ${isMonthStart?"month-start":""}" style="flex:0 0 ${dayWidth}px" ${isMonthStart?`data-month="${d.toLocaleDateString(undefined,{month:"short"})}"`:""}>${label}</div>`;
  }

  // Day-grid overlay for shading (reused per row)
  function dayGridHtml() {
    let h = '<div class="day-grid">';
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(start, i);
      const dow = d.getDay();
      const isWeekend = (dow === 0 || dow === 6);
      h += `<div style="flex:0 0 ${dayWidth}px" class="${isWeekend?"weekend":""}"></div>`;
    }
    h += '</div>';
    return h;
  }

  // Today line position
  const todayInRange = today >= start && today < end;
  const todayX = todayInRange ? xFor(today) + dayWidth/2 : -1;

  // Periods band
  let periodsHtml = "";
  periods.forEach(p => {
    const ps = dayStart(new Date(p.start + "T12:00:00"));
    const pe = dayStart(new Date(p.end + "T12:00:00"));
    if (pe < start || ps >= end) return; // out of range
    const x1 = Math.max(0, xFor(ps));
    const x2 = Math.min(gridW, xRange(pe));
    const w = Math.max(4, x2 - x1);
    periodsHtml += `
      <div class="period-bar" data-period-id="${p.id}" style="left:${x1}px;width:${w}px;background:${p.color||"#4f46e5"}" title="${esc(p.label)} · ${p.start} → ${p.end}">
        <div class="resize-handle left" data-edge="start"></div>
        <span style="position:relative;z-index:1;">${esc(p.label)}</span>
        <div class="resize-handle right" data-edge="end"></div>
      </div>`;
  });

  // Task rows
  function rowHtml(c) {
    const col = state.columns[c.columnId];
    const board = state.boards.find(b => b.columnIds.includes(c.columnId));
    const isDone = board && (board.doneColumnIds||[]).includes(c.columnId);
    const created = dayStart(new Date(c.created));
    const due = c.due ? dayStart(new Date(c.due + "T12:00:00")) : null;
    const prClass = c.priority === "High" ? "priority-high" : c.priority === "Med" ? "priority-med" : c.priority === "Low" ? "priority-low" : "";
    const overdue = due && due < today && !isDone;

    let track = `<div class="task-track">${dayGridHtml()}`;
    if (due) {
      // bar from max(created, start) to due+1
      const cStart = created < start ? start : created;
      const cEnd = due >= end ? addDays(end, -1) : due;
      if (cEnd >= start && cStart <= addDays(end, -1)) {
        const x1 = Math.max(0, xFor(cStart));
        const x2 = Math.min(gridW, xRange(cEnd));
        const w = Math.max(6, x2 - x1);
        track += `<div class="task-bar ${prClass} ${isDone?"done":""} ${overdue?"overdue":""}" data-card-id="${c.id}" style="left:${x1}px;width:${w}px;" title="${esc(c.title)}\nCreated: ${isoDate(created)}\nDue: ${c.due}">${esc(c.title)}</div>`;
      }
    }
    track += `</div>`;

    const ctx = [col?.name, c.priority && c.priority !== "None" ? c.priority : null].filter(Boolean).join(" · ");
    return `
      <div class="sched-cell label" data-card-id="${c.id}" style="cursor:pointer">
        <span class="row-title">${esc(c.title)}</span>
        <span class="row-sub">${esc(ctx)}</span>
      </div>
      ${track}
    `;
  }

  // Section header HTML (sticky top row)
  const sectionHead = `
    <div class="sched-cell label section-head">Periods</div>
    <div class="sched-cell track section-head">
      <div class="periods-track" id="periods-track">
        ${periodsHtml}
      </div>
      <div class="sched-days">${daysHtml}</div>
    </div>
  `;

  let tasksHtml = "";
  dated.forEach(c => tasksHtml += rowHtml(c));
  if (undated.length) {
    tasksHtml += `
      <div class="sched-cell label" style="background:var(--surface-2);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-subtle);">No deadline</div>
      <div class="sched-cell track" style="background:var(--surface-2);height:24px;"></div>
    `;
    undated.forEach(c => tasksHtml += rowHtml(c));
  }

  if (!cards.length) {
    canvas.innerHTML = `
      <div class="sched-grid" style="--label-w:${labelW}px;--grid-w:${gridW}px;">
        ${sectionHead}
      </div>
      <div class="sched-empty">
        <p>No cards in this board.</p>
        <p style="font-size:12px;">Create cards on the Board tab — those with a due date will appear here.</p>
      </div>`;
  } else {
    canvas.innerHTML = `
      <div class="sched-grid" style="--label-w:${labelW}px;--grid-w:${gridW}px;">
        ${sectionHead}
        ${tasksHtml}
      </div>`;
  }

  // Auto-scroll so today is visible
  if (todayInRange) {
    const targetX = todayX - canvas.clientWidth / 2 + labelW;
    canvas.scrollLeft = Math.max(0, targetX);
  } else {
    canvas.scrollLeft = 0;
  }

  // Wire clicks
  canvas.querySelectorAll("[data-card-id]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openCardModal(el.dataset.cardId);
    });
  });
  canvas.querySelectorAll(".period-bar").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      const p = state.periods.find(x => x.id === el.dataset.periodId);
      if (p) openPeriodDialog(p);
    });
    // Resize via drag
    el.querySelectorAll(".resize-handle").forEach(h => {
      h.addEventListener("mousedown", (e) => beginPeriodResize(e, el.dataset.periodId, h.dataset.edge, dayWidth, start));
    });
  });

  // Click-drag on empty periods track to create a new period
  const periodsTrack = canvas.querySelector("#periods-track");
  if (periodsTrack) {
    periodsTrack.addEventListener("mousedown", (e) => {
      if (e.target.closest(".period-bar")) return;
      beginPeriodCreate(e, dayWidth, start);
    });
  }
}

function beginPeriodCreate(e, dayWidth, start) {
  const track = e.currentTarget;
  const rect = track.getBoundingClientRect();
  const startX = e.clientX - rect.left;
  const ghost = document.createElement("div");
  ghost.className = "period-bar";
  ghost.style.background = PERIOD_COLORS[0];
  ghost.style.opacity = "0.6";
  ghost.style.left = startX + "px";
  ghost.style.width = "4px";
  ghost.style.pointerEvents = "none";
  track.appendChild(ghost);

  function onMove(ev) {
    const x = ev.clientX - rect.left;
    const minX = Math.min(startX, x);
    const w = Math.abs(x - startX);
    ghost.style.left = minX + "px";
    ghost.style.width = Math.max(4, w) + "px";
  }
  function onUp(ev) {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    const x = ev.clientX - rect.left;
    const d1 = Math.floor(Math.min(startX, x) / dayWidth);
    const d2 = Math.floor(Math.max(startX, x) / dayWidth);
    ghost.remove();
    if (d2 - d1 < 1) return; // ignore tiny drags
    const sDate = addDays(start, d1);
    const eDate = addDays(start, d2);
    const label = prompt("Period name:", "");
    if (!label || !label.trim()) return;
    const id = uid("pd");
    state.periods.push({
      id, label: label.trim(),
      start: isoDate(sDate), end: isoDate(eDate),
      color: PERIOD_COLORS[state.periods.length % PERIOD_COLORS.length]
    });
    logActivity(`Created period <em>${esc(label.trim())}</em>`);
    save();
    renderSchedule();
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  e.preventDefault();
}

function beginPeriodResize(e, periodId, edge, dayWidth, start) {
  e.stopPropagation();
  e.preventDefault();
  const period = state.periods.find(p => p.id === periodId);
  if (!period) return;
  const track = e.target.closest(".periods-track");
  const rect = track.getBoundingClientRect();

  function snapDate(clientX) {
    const x = clientX - rect.left;
    const dayIdx = Math.max(0, Math.floor(x / dayWidth));
    return isoDate(addDays(start, dayIdx));
  }
  function onMove(ev) {
    const d = snapDate(ev.clientX);
    if (edge === "start") {
      if (new Date(d) <= new Date(period.end)) period.start = d;
    } else {
      if (new Date(d) >= new Date(period.start)) period.end = d;
    }
    renderSchedule();
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    save();
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function openPeriodDialog(period) {
  const isNew = !period;
  const today = isoDate(new Date());
  if (isNew) {
    period = {
      id: uid("pd"),
      label: "",
      start: today,
      end: isoDate(addDays(new Date(), 14)),
      color: PERIOD_COLORS[state.periods.length % PERIOD_COLORS.length]
    };
  }
  const draft = { ...period };

  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `
    <div class="modal period-dialog" style="max-width:440px;">
      <div class="modal-head">
        <div style="flex:1">
          <div class="col-label">${isNew ? "New period" : "Edit period"}</div>
          <input class="title-input" placeholder="e.g. Prototype, Beta, Sprint 3" data-f="label" value="${esc(draft.label||"")}">
        </div>
        <button class="close" data-act="close">${svgIcon("x",16)}</button>
      </div>
      <div class="modal-body" style="grid-template-columns:1fr;display:block;">
        <div class="row">
          <label>Start</label>
          <input type="date" data-f="start" value="${draft.start}">
        </div>
        <div class="row">
          <label>End</label>
          <input type="date" data-f="end" value="${draft.end}">
        </div>
        <div class="row">
          <label>Color</label>
          <div class="color-swatches">
            ${PERIOD_COLORS.map(c => `<div class="sw ${c===draft.color?"active":""}" data-color="${c}" style="background:${c}"></div>`).join("")}
          </div>
        </div>
      </div>
      <div class="modal-foot">
        ${isNew ? `<div></div>` : `<button class="danger" data-act="delete">${svgIcon("trash",12)} Delete</button>`}
        <button class="primary" data-act="save">${isNew ? "Create period" : "Save"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(bd);

  const $ = sel => bd.querySelector(sel);
  bd.addEventListener("click", e => { if (e.target === bd) bd.remove(); });
  $("[data-act=close]").addEventListener("click", () => bd.remove());

  $("[data-f=label]").addEventListener("input", e => draft.label = e.target.value);
  $("[data-f=start]").addEventListener("change", e => draft.start = e.target.value);
  $("[data-f=end]").addEventListener("change", e => draft.end = e.target.value);
  bd.querySelectorAll(".sw").forEach(sw => sw.addEventListener("click", () => {
    draft.color = sw.dataset.color;
    bd.querySelectorAll(".sw").forEach(x => x.classList.toggle("active", x.dataset.color === draft.color));
  }));

  $("[data-act=save]").addEventListener("click", () => {
    if (!draft.label.trim()) { toast("Give the period a name.", "warn"); return; }
    if (new Date(draft.end) < new Date(draft.start)) { toast("End must be after start.", "warn"); return; }
    if (isNew) {
      state.periods.push({ ...draft, label: draft.label.trim() });
      logActivity(`Created period <em>${esc(draft.label.trim())}</em>`);
    } else {
      Object.assign(period, draft, { label: draft.label.trim() });
      logActivity(`Updated period <em>${esc(period.label)}</em>`);
    }
    save();
    bd.remove();
    renderSchedule();
  });

  const delBtn = $("[data-act=delete]");
  if (delBtn) delBtn.addEventListener("click", () => {
    if (!confirm(`Delete period "${period.label}"?`)) return;
    state.periods = state.periods.filter(p => p.id !== period.id);
    logActivity(`Deleted period <em>${esc(period.label)}</em>`);
    save();
    bd.remove();
    renderSchedule();
  });

  setTimeout(() => $("[data-f=label]").focus(), 0);
}

// ---------- Activity view ----------
function renderActivity() {
  const host = document.getElementById("activity-list");
  if (!state.activity.length) {
    host.innerHTML = `<div style="color:var(--text-muted)">No activity yet.</div>`;
    return;
  }
  host.innerHTML = state.activity.slice(0, 200).map(a =>
    `<div class="activity-item"><div class="when">${new Date(a.at).toLocaleString()}</div><div class="text">${a.text}</div></div>`
  ).join("");
}

// ---------- Views ----------
function setView(v) {
  state.activeView = v;
  document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === "view-" + v));
  document.querySelectorAll(".topbar .tab").forEach(t => t.classList.toggle("active", t.dataset.view === v));
  if (v === "board") renderBoard();
  if (v === "schedule") renderSchedule();
  if (v === "wiki") renderWiki();
  if (v === "activity") renderActivity();
  save();
}

// ---------- Import / Export ----------
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  a.href = url;
  a.download = `kanban-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  localStorage.setItem(LAST_EXPORT_KEY, Date.now().toString());
  toast("Exported to JSON ✓", "ok");
  renderTopbar();
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.boards || !data.cards || !data.wiki) throw new Error("Missing required fields");
      if (!confirm("Replace your current data with this file? (Your current data will be lost unless exported.)")) return;
      state = data;
      // Backfill any missing fields
      state.activity = state.activity || [];
      state.people = state.people || [];
      state.tags = state.tags || [];
      logActivity(`Imported data from JSON`);
      save();
      setView(state.activeView || "board");
      toast("Imported ✓", "ok");
    } catch (err) {
      toast("Couldn't import: " + err.message, "warn");
    }
  };
  reader.readAsText(file);
}

// ---------- Search / Command Palette ----------
let cmdkOpen = false;
function openCmdk(initial = "") {
  if (cmdkOpen) return;
  cmdkOpen = true;
  const bd = document.createElement("div");
  bd.className = "cmdk-backdrop";
  bd.innerHTML = `
    <div class="cmdk">
      <input placeholder="Search cards, pages, commands…" value="${esc(initial)}">
      <div class="results"></div>
    </div>`;
  document.body.appendChild(bd);
  const input = bd.querySelector("input");
  const results = bd.querySelector(".results");
  let active = 0;
  let items = [];

  function search(q) {
    q = q.trim().toLowerCase();
    const arr = [];
    if (!q) {
      arr.push({ kind: "Go to", label: "Board", action: () => setView("board") });
      arr.push({ kind: "Go to", label: "Schedule", action: () => setView("schedule") });
      arr.push({ kind: "Go to", label: "Wiki", action: () => setView("wiki") });
      arr.push({ kind: "Go to", label: "Activity", action: () => setView("activity") });
      arr.push({ kind: "Action", label: "Export JSON", action: exportData });
      arr.push({ kind: "Action", label: "Import JSON", action: () => document.getElementById("import-input").click() });
      arr.push({ kind: "Action", label: "New card", action: () => { setView("board"); addCard(activeBoard().columnIds[0]); } });
      arr.push({ kind: "Action", label: "New wiki page", action: () => { setView("wiki"); const p = createPage(null); state.activeWikiPageId = p.id; save(); renderWiki(); } });
      arr.push({ kind: "Action", label: "New schedule period", action: () => { setView("schedule"); setTimeout(() => openPeriodDialog(null), 50); } });
    } else {
      Object.values(state.cards).forEach(c => {
        if ((c.title||"").toLowerCase().includes(q) || (c.description||"").toLowerCase().includes(q)) {
          const col = state.columns[c.columnId];
          arr.push({ kind: "Card", label: c.title, ctx: col?.name || "", action: () => { setView("board"); openCardModal(c.id); } });
        }
      });
      Object.values(state.wiki.pages).forEach(p => {
        if ((p.title||"").toLowerCase().includes(q) || (p.body||"").toLowerCase().includes(q)) {
          arr.push({ kind: "Wiki", label: p.title, ctx: (p.tags||[]).join(", "), action: () => { setView("wiki"); state.activeWikiPageId = p.id; save(); renderWiki(); } });
        }
      });
      ["board", "schedule", "wiki", "activity"].forEach(v => {
        if (v.includes(q)) arr.push({ kind: "Go to", label: v[0].toUpperCase()+v.slice(1), action: () => setView(v) });
      });
    }
    items = arr.slice(0, 30);
    active = 0;
    drawList();
  }
  function drawList() {
    if (!items.length) {
      results.innerHTML = `<div class="empty-r">No results</div>`;
      return;
    }
    results.innerHTML = items.map((it, i) => `
      <div class="result ${i===active?"active":""}" data-i="${i}">
        <span class="kind">${esc(it.kind)}</span>
        <span class="label">${esc(it.label)}</span>
        <span class="ctx">${esc(it.ctx||"")}</span>
      </div>
    `).join("");
    results.querySelectorAll(".result").forEach(r => {
      r.addEventListener("click", () => { items[+r.dataset.i].action(); close(); });
      r.addEventListener("mousemove", () => {
        active = +r.dataset.i;
        results.querySelectorAll(".result").forEach((x, i) => x.classList.toggle("active", i === active));
      });
    });
  }
  function close() {
    bd.remove();
    cmdkOpen = false;
  }
  input.addEventListener("input", () => search(input.value));
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); active = (active+1) % Math.max(items.length, 1); drawList(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active-1+items.length) % Math.max(items.length, 1); drawList(); }
    else if (e.key === "Enter") {
      if (items[active]) { items[active].action(); close(); }
    }
  });
  bd.addEventListener("click", e => { if (e.target === bd) close(); });
  search(initial);
  setTimeout(() => input.focus(), 0);
}

// ---------- Shortcuts ----------
let gPending = false;
function bindKeys() {
  document.addEventListener("keydown", e => {
    if (currentModalCardId || cmdkOpen) {
      if (e.key === "Escape") {
        if (currentModalCardId) {
          const m = document.getElementById("card-modal");
          if (m) m.remove();
          currentModalCardId = null;
          if (state.activeView === "schedule") renderSchedule();
          else if (state.activeView === "wiki") renderWiki();
          else renderBoard();
        }
      }
      return;
    }
    const tag = (e.target.tagName || "").toLowerCase();
    const inField = tag === "input" || tag === "textarea" || e.target.isContentEditable;
    if (e.key === "/" && !inField) { e.preventDefault(); openCmdk(); }
    else if (e.key === "?" && !inField) { e.preventDefault(); showShortcutsHelp(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCmdk(); }
    else if (e.key === "g" && !inField) { gPending = true; setTimeout(() => { gPending = false; }, 800); }
    else if (gPending && e.key === "b") { gPending = false; setView("board"); }
    else if (gPending && e.key === "w") { gPending = false; setView("wiki"); }
    else if (gPending && e.key === "s") { gPending = false; setView("schedule"); }
    else if (gPending && e.key === "a") { gPending = false; setView("activity"); }
    else if (e.key === "n" && !inField) {
      e.preventDefault();
      if (state.activeView === "board") addCard(activeBoard().columnIds[0]);
      else if (state.activeView === "wiki") { const p = createPage(null); state.activeWikiPageId = p.id; save(); renderWiki(); }
      else if (state.activeView === "schedule") { openPeriodDialog(null); }
    } else if (e.key.toLowerCase() === "e" && !inField && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      exportData();
    }
  });
}

function showShortcutsHelp() {
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div class="modal-head"><div style="flex:1"><div class="col-label">Help</div><div class="title-input" style="font-size:18px;font-weight:600;">Keyboard shortcuts</div></div><button class="close" id="x">${svgIcon("x",16)}</button></div>
      <div class="modal-body" style="grid-template-columns:1fr;padding:18px;">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 18px;font-size:13px;">
          <span><span class="kbd">/</span> or <span class="kbd">⌘K</span></span><span>Open search</span>
          <span><span class="kbd">n</span></span><span>New card (on Board) / new page (on Wiki)</span>
          <span><span class="kbd">g</span> <span class="kbd">b</span></span><span>Go to Board</span>
          <span><span class="kbd">g</span> <span class="kbd">s</span></span><span>Go to Schedule</span>
          <span><span class="kbd">g</span> <span class="kbd">w</span></span><span>Go to Wiki</span>
          <span><span class="kbd">g</span> <span class="kbd">a</span></span><span>Go to Activity</span>
          <span><span class="kbd">⌘⇧E</span></span><span>Export data</span>
          <span><span class="kbd">?</span></span><span>This help</span>
          <span><span class="kbd">Esc</span></span><span>Close any panel</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.addEventListener("click", e => { if (e.target === bd) close(); });
  bd.querySelector("#x").addEventListener("click", close);
}

// ---------- Tweaks ----------
const THEMES = [
  { id: "crisp",     name: "Crisp",     swatches: ["#ffffff", "#4f46e5", "#0a0a0a"] },
  { id: "notebook",  name: "Notebook",  swatches: ["#fbf8f1", "#b54a2d", "#2b2618"] },
  { id: "terminal",  name: "Terminal",  swatches: ["#0d100e", "#3ddc84", "#c8e6c8"] },
  { id: "midnight",  name: "Midnight",  swatches: ["#0d1326", "#6e8fff", "#d8e3ff"] },
  { id: "solarized", name: "Solarized", swatches: ["#fdf6e3", "#268bd2", "#073642"] },
  { id: "rose",      name: "Rose",      swatches: ["#fff7f9", "#be185d", "#41121e"] },
  { id: "forest",    name: "Forest",    swatches: ["#fafcf7", "#2f7d32", "#1b2a17"] },
];

function bindTweaks() {
  const panel = document.getElementById("tweaks");
  // Build theme picker
  const themeHost = panel.querySelector("#tw-themes");
  themeHost.innerHTML = THEMES.map(t => `
    <button data-theme="${t.id}" class="${settings.theme === t.id ? "active" : ""}">
      <span class="swatch-set">
        ${t.swatches.map(c => `<i style="background:${c}"></i>`).join("")}
      </span>
      <span>${esc(t.name)}</span>
    </button>
  `).join("");
  themeHost.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      settings.theme = b.dataset.theme;
      themeHost.querySelectorAll("button").forEach(x => x.classList.toggle("active", x.dataset.theme === settings.theme));
      applyTheme();
      saveSettings();
    });
  });
  // Mode toggle
  const mt = panel.querySelector("#tw-mode");
  mt.checked = settings.mode === "dark";
  mt.addEventListener("change", () => {
    settings.mode = mt.checked ? "dark" : "light";
    applyTheme(); saveSettings();
  });
  const rem = panel.querySelector("#tw-rem");
  rem.checked = settings.exportReminder;
  rem.addEventListener("change", () => {
    settings.exportReminder = rem.checked;
    saveSettings(); renderTopbar();
  });
  // Close
  panel.querySelector(".close").addEventListener("click", () => {
    panel.classList.remove("open");
    window.parent && window.parent.postMessage({type: "__edit_mode_dismissed"}, "*");
  });
  // Listen for activation
  window.addEventListener("message", e => {
    if (!e.data) return;
    if (e.data.type === "__activate_edit_mode") panel.classList.add("open");
    if (e.data.type === "__deactivate_edit_mode") panel.classList.remove("open");
  });
  window.parent && window.parent.postMessage({type: "__edit_mode_available"}, "*");
}

// ---------- Icons (inline SVG) ----------
function svgIcon(name, size = 14) {
  const s = size;
  const stroke = `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const map = {
    plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
    x: `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`,
    chev: `<polyline points="9 6 15 12 9 18"/>`,
    dots: `<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>`,
    user: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    tag: `<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`,
    archive: `<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/>`,
    trash: `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>`,
    edit: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    check: `<polyline points="20 6 9 17 4 12"/>`,
    clock: `<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>`,
    book: `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`,
    folder: `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`,
    page: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
    search: `<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
    download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
    upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
    moon: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
    sun: `<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>`,
    activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
    undo: `<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>`,
    home: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/>`,
    sliders: `<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>`,
    grip: `<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></g>`,
    help: `<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    board: `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>`,
    image: `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`,
    link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`
  };
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" ${stroke}>${map[name]||""}</svg>`;
}

// ---------- Esc helper used in templates ----------
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
window.__esc = esc; // expose if needed

// ---------- Boot ----------
function boot() {
  load();
  applyTheme();

  // Topbar tabs
  document.querySelectorAll(".topbar .tab").forEach(t => {
    t.addEventListener("click", () => setView(t.dataset.view));
  });
  // Export/import
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-input").click());
  const headerExportLink = document.getElementById("header-export-link");
  if (headerExportLink) headerExportLink.addEventListener("click", exportData);
  const wikiNewRoot = document.getElementById("wiki-new-root");
  if (wikiNewRoot) wikiNewRoot.addEventListener("click", () => {
    setView("wiki");
    const p = createPage(null);
    state.activeWikiPageId = p.id;
    save();
    renderWiki();
  });
  document.getElementById("import-input").addEventListener("change", e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("btn-search").addEventListener("click", () => openCmdk());
  document.getElementById("btn-help").addEventListener("click", showShortcutsHelp);
  const newBoardBtn = document.getElementById("new-board-btn");
  if (newBoardBtn) newBoardBtn.addEventListener("click", () => {
    const name = prompt("Board name", "");
    if (!name || !name.trim()) return;
    const id = uid("b");
    const c1 = uid("c"), c2 = uid("c"), c3 = uid("c");
    state.boards.push({
      id, name: name.trim(),
      columnIds: [c1, c2, c3], doneColumnIds: [c3],
      filter: {}, created: now()
    });
    state.columns[c1] = { id: c1, name: "To do", color: "#737373" };
    state.columns[c2] = { id: c2, name: "Doing", color: "#d97706" };
    state.columns[c3] = { id: c3, name: "Done", color: "#059669" };
    state.activeBoardId = id;
    setView("board");
    logActivity(`Created board <em>${esc(name.trim())}</em>`);
    save();
    renderBoard();
  });
  document.getElementById("btn-tweaks").addEventListener("click", () => {
    document.getElementById("tweaks").classList.toggle("open");
  });
  document.getElementById("btn-mode").addEventListener("click", () => {
    settings.mode = settings.mode === "dark" ? "light" : "dark";
    applyTheme(); saveSettings();
    const mt = document.querySelector("#tw-mode"); if (mt) mt.checked = settings.mode === "dark";
  });

  // Drag & drop file import on whole window
  window.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  window.addEventListener("drop", e => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    // Always prevent default so the browser doesn't navigate to/open the dropped file
    e.preventDefault();
    const json = files.find(f => f.name.toLowerCase().endsWith(".json"));
    if (json) importData(json);
  });

  // beforeunload reminder
  window.addEventListener("beforeunload", e => {
    if (!settings.exportReminder) return;
    const last = parseInt(localStorage.getItem(LAST_EXPORT_KEY) || "0", 10);
    if (!last || (Date.now() - last) > 3600 * 1000) {
      e.preventDefault();
      e.returnValue = "Don't forget to export your data!";
      return e.returnValue;
    }
  });

  bindKeys();
  bindTweaks();
  setView(state.activeView || "board");
  renderTopbar();
  renderStorageMeter();
  // Tick the topbar timestamp every minute
  setInterval(renderTopbar, 60000);
}

document.addEventListener("DOMContentLoaded", boot);
})();
