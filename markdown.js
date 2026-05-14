/* Minimal Markdown renderer — no external deps.
   Supports: headings, bold/italic/strike, inline code, fenced code,
   blockquotes, lists (incl. nested + tasks), tables, links, images,
   hr, paragraphs, autolinks. Escapes HTML.
*/
(function () {
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(s) {
    // Escape first, then re-apply markup
    s = esc(s);
    // Inline code
    s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
    // Bold + italic
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
    s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    // Strikethrough
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    // Images ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, a, u) => `<img alt="${a}" src="${u}">`);
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`);
    // Wiki links [[Page Name]]
    s = s.replace(/\[\[([^\]]+)\]\]/g, (_, p) => `<a href="#wiki:${encodeURIComponent(p)}" data-wikilink="${p}">${p}</a>`);
    // Autolinks
    s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noreferrer">${u}</a>`);
    return s;
  }

  function render(md) {
    if (!md) return '<p class="md-empty" style="color:var(--text-subtle);">Start writing…</p>';
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    let out = [];
    let i = 0;
    // Stack of open list items: each entry { type: 'ul'|'ol', indent: N }
    let listStack = [];

    function closeListsTo(indent) {
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) {
        const top = listStack.pop();
        out.push(`</${top.type}>`);
      }
    }
    function closeAllLists() { closeListsTo(-1); }

    while (i < lines.length) {
      let line = lines[i];

      // Fenced code block
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        closeAllLists();
        const lang = fence[1] || "";
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(esc(lines[i]));
          i++;
        }
        i++;
        out.push(`<pre><code class="lang-${lang}">${buf.join("\n")}</code></pre>`);
        continue;
      }

      // Horizontal rule
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        closeAllLists();
        out.push("<hr>");
        i++; continue;
      }

      // Heading
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        closeAllLists();
        const lvl = h[1].length;
        out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
        i++; continue;
      }

      // Blockquote
      if (/^>\s?/.test(line)) {
        closeAllLists();
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push(`<blockquote>${render(buf.join("\n"))}</blockquote>`);
        continue;
      }

      // Table (simple): | h | h |\n|---|---|\n| c | c |
      if (/^\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|\s*$/.test(lines[i+1])) {
        closeAllLists();
        const header = line.split("|").slice(1, -1).map(s => s.trim());
        i += 2; // skip header + sep
        const rows = [];
        while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) {
          rows.push(lines[i].split("|").slice(1, -1).map(s => s.trim()));
          i++;
        }
        out.push("<table><thead><tr>" +
          header.map(h => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>" +
          rows.map(r => "<tr>" + r.map(c => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
          "</tbody></table>");
        continue;
      }

      // List item (ul/ol/task)
      const li = line.match(/^(\s*)(-|\*|\+|\d+\.)\s+(\[( |x|X)\]\s+)?(.*)$/);
      if (li) {
        const indent = li[1].length;
        const marker = li[2];
        const isOrdered = /^\d+\./.test(marker);
        const type = isOrdered ? "ol" : "ul";
        const taskMatch = li[3];
        const taskChecked = li[4] && li[4].toLowerCase() === "x";
        const text = li[5];

        // Pop deeper lists
        closeListsTo(indent + 1);

        // If new list at this level
        const top = listStack[listStack.length - 1];
        if (!top || top.indent < indent || top.type !== type) {
          // If same-indent different type, close it
          if (top && top.indent === indent && top.type !== type) {
            out.push(`</${top.type}>`);
            listStack.pop();
          }
          out.push(`<${type}>`);
          listStack.push({ type, indent });
        }

        if (taskMatch) {
          out.push(`<li class="task-line"><input type="checkbox" disabled ${taskChecked ? "checked" : ""}>${inline(text)}</li>`);
        } else {
          out.push(`<li>${inline(text)}</li>`);
        }
        i++; continue;
      }

      // Blank line
      if (/^\s*$/.test(line)) {
        closeAllLists();
        i++; continue;
      }

      // Paragraph (accumulate until blank/structure)
      closeAllLists();
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6}\s|>|```|-{3,}$|\*{3,}$|_{3,}$|\|)/.test(lines[i]) &&
             !/^(\s*)(-|\*|\+|\d+\.)\s+/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }
    closeAllLists();
    return out.join("\n");
  }

  window.mdRender = render;
})();
