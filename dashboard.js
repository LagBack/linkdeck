"use strict";

const $ = (s) => document.querySelector(s);
const DEFAULT_CATS = ["Development", "Learning", "Projects", "Entertainment", "Work", "Other"];

const state = {
  items: [],
  meta: {},            // key -> { notes, tags[], category, pinned }
  cats: [...DEFAULT_CATS],
  settings: { previews: false, localShots: false, showExtensions: true, view: "grid" },
  shots: new Map(),    // normalized url -> object URL of the saved preview
  type: "all",         // all | bookmark | extension
  cat: null,
  q: "",
  selected: null,
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const favicon = (u, size = 64) => `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(u)}&size=${size}`;
const getMeta = (key) => state.meta[key] || (state.meta[key] = { notes: "", tags: [], category: "Other", pinned: false });

function gradient(seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 55% 28%), hsl(${(h + 45) % 360} 60% 20%))`;
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ meta: state.meta, cats: state.cats, settings: state.settings }), 250);
}

/* ---------- Data loading ---------- */
function flatten(nodes, folder, out) {
  for (const n of nodes) {
    if (n.url) {
      if (/^(https?|ftp|file|chrome):/i.test(n.url)) out.push({ id: n.id, url: n.url, title: n.title || host(n.url), folder });
    } else if (n.children) flatten(n.children, n.title || folder, out);
  }
  return out;
}

async function loadItems() {
  const items = [];
  const tree = await chrome.bookmarks.getTree();
  const seen = new Set();
  for (const b of flatten(tree, "", [])) {
    if (seen.has(b.url)) continue;
    seen.add(b.url);
    items.push({ key: "b:" + b.url, type: "bookmark", id: b.id, title: b.title, url: b.url, desc: host(b.url), folder: b.folder });
  }
  if (state.settings.showExtensions) {
    const exts = await chrome.management.getAll();
    for (const e of exts) {
      if (e.type !== "extension" || e.id === chrome.runtime.id) continue;
      const icon = (e.icons || []).sort((a, b) => b.size - a.size)[0]?.url;
      items.push({ key: "e:" + e.id, type: "extension", id: e.id, title: e.name, url: e.homepageUrl || "", icon, desc: e.description || "", enabled: e.enabled, options: e.optionsUrl });
    }
  }
  state.items = items;
}

/* ---------- Filtering ---------- */
const catOf = (it) => getMeta(it.key).category || "Other";

function visible() {
  const q = state.q.trim().toLowerCase();
  return state.items
    .filter((it) => state.type === "all" || it.type === state.type)
    .filter((it) => !state.cat || catOf(it) === state.cat)
    .filter((it) => {
      if (!q) return true;
      const m = getMeta(it.key);
      return [it.title, it.url, it.desc, m.notes, m.tags.join(" "), catOf(it)].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => (getMeta(b.key).pinned - getMeta(a.key).pinned) || a.title.localeCompare(b.title));
}

/* ---------- Rendering ---------- */
async function loadShots() {
  for (const u of state.shots.values()) URL.revokeObjectURL(u);
  state.shots.clear();
  try {
    for (const [key, val] of await Shots.entries()) state.shots.set(key, URL.createObjectURL(val.blob));
  } catch { /* previews are optional */ }
}

// Real screenshot if we have one, else the online service (if enabled), else the gradient.
function shotUrl(it) {
  if (it.type !== "bookmark") return null;
  const local = state.shots.get(Shots.norm(it.url));
  if (local) return { src: local, remote: false };
  if (state.settings.previews && it.url.startsWith("http"))
    return { src: `https://image.thum.io/get/width/600/crop/400/${it.url}`, remote: true };
  return null;
}

function thumbHtml(it) {
  const icon = it.type === "extension" ? it.icon : favicon(it.url);
  const bg = gradient(it.title + it.url);
  const s = shotUrl(it);
  const shot = s ? `<img class="shot" ${s.remote ? 'loading="lazy"' : ""} src="${esc(s.src)}" alt="" onerror="this.remove()">` : "";
  const mid = s && !s.remote ? ""
    : icon ? `<img class="big" src="${esc(icon)}" alt="">`
    : `<span class="letter">${esc(it.title[0]?.toUpperCase() || "?")}</span>`;
  return `<div class="thumb" style="background:${bg}">${mid}${shot}</div>`;
}

function render() {
  const items = visible();
  renderNav();
  const grid = $("#grid");
  grid.className = "grid" + (state.settings.view === "list" ? " list" : "");
  $("#gridBtn").classList.toggle("on", state.settings.view !== "list");
  $("#listBtn").classList.toggle("on", state.settings.view === "list");
  $("#empty").hidden = items.length > 0;
  $("#status").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;

  grid.innerHTML = items.map((it) => {
    const m = getMeta(it.key);
    const icon = it.type === "extension" ? it.icon : favicon(it.url, 32);
    return `<article class="card ${it.type === "extension" && !it.enabled ? "disabled" : ""}" data-key="${esc(it.key)}">
      ${thumbHtml(it)}
      <div class="card-body">
        <div class="title-row">${icon ? `<img class="fav" src="${esc(icon)}" alt="">` : ""}<span class="title">${esc(it.title)}</span></div>
        <div class="desc">${esc(it.desc)}</div>
        ${m.notes ? `<div class="note-preview">${esc(m.notes)}</div>` : ""}
        <div class="card-foot">
          <span class="badge ${it.type === "bookmark" ? "bm" : ""}">${it.type === "bookmark" ? "Bookmark" : "Extension"}</span>
          ${m.tags.slice(0, 2).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
          <span class="grow"></span>
          <button class="note-btn ${m.notes ? "has" : ""}" data-act="details" title="Notes &amp; details">✎</button>
          <button class="note-btn ${m.pinned ? "has" : ""}" data-act="pin" title="Pin">${m.pinned ? "★" : "☆"}</button>
        </div>
      </div>
    </article>`;
  }).join("");
}

function renderNav() {
  const count = (fn) => state.items.filter(fn).length;
  const types = [["all", "◫", "All"], ["bookmark", "☆", "Bookmarks"], ["extension", "⧉", "Extensions"]]
    .filter(([t]) => t !== "extension" || state.settings.showExtensions);
  $("#typeNav").innerHTML = types.map(([t, ico, label]) =>
    `<button class="nav-item ${state.type === t && !state.cat ? "active" : ""}" data-type="${t}">
      <span class="ico">${ico}</span><span class="label">${label}</span>
      <span class="count">${t === "all" ? state.items.length : count((i) => i.type === t)}</span></button>`).join("");
  $("#catNav").innerHTML = state.cats.map((c) =>
    `<button class="nav-item ${state.cat === c ? "active" : ""}" data-cat="${esc(c)}">
      <span class="ico">▸</span><span class="label">${esc(c)}</span>
      <span class="count">${count((i) => catOf(i) === c)}</span></button>`).join("");
}

/* ---------- Detail panel ---------- */
function openPanel(key) {
  state.selected = key;
  const it = state.items.find((i) => i.key === key);
  if (!it) return closePanel();
  const m = getMeta(key);
  const panel = $("#panel");
  panel.hidden = false;
  panel.innerHTML = `
    <div class="panel-thumb">
      <button class="panel-close" data-act="close">✕</button>
      ${thumbHtml(it)}
    </div>
    <div class="panel-body">
      <div class="panel-head"><div><div class="t">${esc(it.title)}</div><div class="u">${esc(it.url || it.desc)}</div></div></div>
      <div class="panel-actions">
        <button class="btn primary" data-act="open">${it.type === "extension" ? "Settings" : "Open"}</button>
        ${it.type === "extension" ? `<button class="btn" data-act="toggle">${it.enabled ? "Disable" : "Enable"}</button>` : `<button class="btn danger" data-act="delete">Delete</button>`}
      </div>
      <div>
        <div class="field-label"><span>Notes</span><span id="noteCount">${m.notes.length}/500</span></div>
        <textarea id="noteInput" rows="6" maxlength="500" placeholder="Reminders, snippets, what to build next…">${esc(m.notes)}</textarea>
      </div>
      <div>
        <div class="field-label"><span>Tags</span></div>
        <div class="chips" id="chips"></div>
      </div>
      <div>
        <div class="field-label"><span>Category</span></div>
        <select id="catSelect">${state.cats.map((c) => `<option ${c === m.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      </div>
      ${it.folder ? `<div class="hint">Chrome folder: ${esc(it.folder)}</div>` : ""}
    </div>`;
  renderChips();
}

function renderChips() {
  const m = getMeta(state.selected);
  $("#chips").innerHTML = m.tags.map((t, i) => `<span class="chip">${esc(t)}<button data-rm="${i}">×</button></span>`).join("") +
    `<input id="tagInput" type="text" placeholder="+ tag" maxlength="24">`;
}

function closePanel() { state.selected = null; $("#panel").hidden = true; }

/* ---------- Events ---------- */
document.addEventListener("click", async (e) => {
  const nav = e.target.closest("[data-type],[data-cat]");
  if (nav) {
    if (nav.dataset.cat) { state.cat = state.cat === nav.dataset.cat ? null : nav.dataset.cat; state.type = "all"; }
    else { state.type = nav.dataset.type; state.cat = null; }
    return render();
  }

  const card = e.target.closest(".card");
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (card && !e.target.closest("#panel")) {
    const it = state.items.find((i) => i.key === card.dataset.key);
    if (act === "pin") { const m = getMeta(it.key); m.pinned = !m.pinned; persist(); return render(); }
    if (act === "details") { openPanel(it.key); return; }
    return it.type === "extension" ? openExtension(it) : chrome.tabs.create({ url: it.url });
  }

  if (e.target.closest("#panel")) {
    const it = state.items.find((i) => i.key === state.selected);
    if (act === "close") closePanel();
    if (act === "open") it.type === "extension" ? openExtension(it) : chrome.tabs.create({ url: it.url });
    if (act === "toggle") { await chrome.management.setEnabled(it.id, !it.enabled); await refresh(); openPanel(it.key); }
    if (act === "delete" && confirm(`Delete "${it.title}" from your Chrome bookmarks?`)) {
      await chrome.bookmarks.remove(it.id); closePanel(); await refresh();
    }
    const rm = e.target.closest("[data-rm]");
    if (rm) { getMeta(it.key).tags.splice(+rm.dataset.rm, 1); persist(); renderChips(); render(); }
    return;
  }

  if (e.target.closest("[data-close]")) e.target.closest("dialog").close();
});

function openExtension(it) {
  chrome.tabs.create({ url: it.options || `chrome://extensions/?id=${it.id}` });
}

document.addEventListener("input", (e) => {
  if (e.target.id === "noteInput") {
    getMeta(state.selected).notes = e.target.value;
    $("#noteCount").textContent = `${e.target.value.length}/500`;
    persist(); render();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "catSelect") { getMeta(state.selected).category = e.target.value; persist(); render(); }
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "tagInput" && (e.key === "Enter" || e.key === ",")) {
    e.preventDefault();
    const t = e.target.value.trim().toLowerCase().replace(/,/g, "");
    const m = getMeta(state.selected);
    if (t && !m.tags.includes(t)) m.tags.push(t);
    persist(); renderChips(); $("#tagInput").focus(); render();
  } else if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
    e.preventDefault(); $("#search").focus();
  } else if (e.key === "Escape" && !$("dialog[open]")) { closePanel(); }
});

$("#search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("#gridBtn").onclick = () => { state.settings.view = "grid"; persist(); render(); };
$("#listBtn").onclick = () => { state.settings.view = "list"; persist(); render(); };

$("#addCatBtn").onclick = () => {
  const name = prompt("New category name")?.trim();
  if (name && !state.cats.includes(name)) { state.cats.push(name); persist(); render(); }
};

// Add bookmark
$("#addBtn").onclick = async () => {
  $("#addCat").innerHTML = state.cats.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#addCat").value = state.cat || "Other";
  $("#addForm").reset();
  $("#addDialog").showModal();
  $("#addUrl").focus();
};
$("#addForm").addEventListener("submit", async () => {
  let url = $("#addUrl").value.trim();
  if (!/^[a-z]+:/i.test(url)) url = "https://" + url;
  await chrome.bookmarks.create({ title: $("#addTitle").value.trim() || host(url), url });
  const m = getMeta("b:" + url);
  m.notes = $("#addNotes").value.trim();
  m.category = $("#addCat").value;
  persist();
  await refresh();
});

// Settings
$("#settingsBtn").onclick = async () => {
  $("#localShotsToggle").checked = state.settings.localShots && (await hasHostAccess());
  $("#previewsToggle").checked = state.settings.previews;
  $("#extToggle").checked = state.settings.showExtensions;
  $("#settingsDialog").showModal();
};
const hasHostAccess = () => chrome.permissions.contains({ origins: ["<all_urls>"] });
async function ensureHostAccess() { return (await hasHostAccess()) || chrome.permissions.request({ origins: ["<all_urls>"] }); }

$("#localShotsToggle").onchange = async (e) => {
  if (e.target.checked && !(await ensureHostAccess())) e.target.checked = false;
  state.settings.localShots = e.target.checked;
  persist();
};
$("#genBtn").onclick = async () => {
  if (!(await ensureHostAccess())) return;
  const urls = state.items
    .filter((i) => i.type === "bookmark" && /^https?:/.test(i.url) && !state.shots.has(Shots.norm(i.url)))
    .map((i) => i.url);
  if (!urls.length) { $("#genStatus").textContent = "Every bookmark already has a preview."; return; }
  if (!confirm(`Open ${urls.length} page${urls.length === 1 ? "" : "s"} one at a time in a small temporary window to capture previews? This can take a while.`)) return;
  state.settings.localShots = true; $("#localShotsToggle").checked = true; persist();
  $("#genBtn").hidden = true; $("#stopBtn").hidden = false;
  $("#genStatus").textContent = `Capturing 0 / ${urls.length}…`;
  chrome.runtime.sendMessage({ type: "capture-all", urls });
};
$("#stopBtn").onclick = () => chrome.runtime.sendMessage({ type: "cancel-capture" });
$("#clearShotsBtn").onclick = async () => {
  if (!confirm("Delete all saved page previews?")) return;
  await Shots.clear(); await loadShots(); render(); $("#genStatus").textContent = "Previews cleared.";
};

let shotRefresh;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "shot-saved" || msg?.type === "capture-progress") {
    clearTimeout(shotRefresh);
    shotRefresh = setTimeout(async () => { await loadShots(); render(); }, 400);
  }
  if (msg?.type === "capture-progress") {
    $("#genStatus").textContent = msg.finished ? `Done: ${msg.done} / ${msg.total} pages processed.` : `Capturing ${msg.done} / ${msg.total}…`;
    if (msg.finished) { $("#genBtn").hidden = false; $("#stopBtn").hidden = true; }
  }
});

$("#previewsToggle").onchange = (e) => { state.settings.previews = e.target.checked; persist(); render(); };
$("#extToggle").onchange = async (e) => { state.settings.showExtensions = e.target.checked; if (!e.target.checked && state.type === "extension") state.type = "all"; persist(); await refresh(); };
$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ meta: state.meta, cats: state.cats }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "linkdeck-notes.json" });
  a.click(); URL.revokeObjectURL(a.href);
};
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    Object.assign(state.meta, data.meta || {});
    for (const c of data.cats || []) if (!state.cats.includes(c)) state.cats.push(c);
    persist(); render();
  } catch { alert("That file doesn't look like a LinkDeck export."); }
};

/* ---------- Init ---------- */
async function refresh() { await loadItems(); render(); if (state.selected) openPanel(state.selected); }

(async function init() {
  const saved = await chrome.storage.local.get(["meta", "cats", "settings"]);
  if (saved.meta) state.meta = saved.meta;
  if (saved.cats) state.cats = saved.cats;
  if (saved.settings) Object.assign(state.settings, saved.settings);
  await loadShots();
  await refresh();
  for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) chrome.bookmarks[ev].addListener(() => refresh());
  chrome.management.onInstalled.addListener(refresh);
  chrome.management.onUninstalled.addListener(refresh);
})();
