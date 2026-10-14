"use strict";

// Theme selector: each visual world is applied to the whole document and remembered locally.
function initThemeToggle() {
  const root = document.documentElement;
  const toggle = document.getElementById("themeToggle");
  const menu = document.getElementById("themeMenu");
  if (!toggle || !menu) return;
  const validThemes = new Set(["light", "xp", "scenecore", "gxsc", "pixel", "cutecore", "webcore", "terminal"]);
  try {
    const saved = localStorage.getItem("linkdeck-theme");
    if (validThemes.has(saved) && saved !== "light") root.dataset.theme = saved;
  } catch (_) {}

  const getTheme = () => root.dataset.theme || "light";
  const sync = () => {
    const current = getTheme();
    menu.querySelectorAll("[data-theme-choice]").forEach((item) => {
      const selected = item.dataset.themeChoice === current;
      item.setAttribute("aria-checked", String(selected));
      item.classList.toggle("selected", selected);
    });
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
    toggle.setAttribute("aria-label", `Choose appearance. Current theme: ${{light:"LinkDeck Original",xp:"Windows 98 / XP",scenecore:"Scenecore",gxsc:"GXSC",pixel:"Pixel Night",cutecore:"Cutecore",webcore:"Old Web",terminal:"Terminal"}[current]}`);
    toggle.title = `Theme: ${{light:"LinkDeck Original",xp:"Windows 98 / XP",scenecore:"Scenecore",gxsc:"GXSC",pixel:"Pixel Night",cutecore:"Cutecore",webcore:"Old Web",terminal:"Terminal"}[current]}`;
  };
  const closeMenu = (returnFocus = false) => {
    menu.hidden = true;
    sync();
    if (returnFocus) toggle.focus();
  };
  const setTheme = (theme) => {
    if (!validThemes.has(theme)) return;
    if (theme === "light") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try { localStorage.setItem("linkdeck-theme", theme); } catch (_) {}
    closeMenu();
    document.querySelectorAll("[data-onboarding-theme]").forEach((card) => {
      const selected = card.dataset.onboardingTheme === theme;
      card.setAttribute("aria-pressed", String(selected));
      card.classList.toggle("selected", selected);
    });
  };
  window.linkdeckSetTheme = setTheme;
  window.linkdeckGetTheme = getTheme;
  toggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    sync();
    if (!menu.hidden) menu.querySelector(`[data-theme-choice="${getTheme()}"]`)?.focus();
  });
  menu.querySelectorAll("[data-theme-choice]").forEach((item) => {
    item.addEventListener("click", () => setTheme(item.dataset.themeChoice));
    item.addEventListener("keydown", (event) => {
      const options = [...menu.querySelectorAll("[data-theme-choice]")];
      const index = options.indexOf(item);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
      }
      if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".theme-picker-wrap")) closeMenu();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) closeMenu(true); });
  sync();
}
initThemeToggle();

// A playful, reversible CRT overlay available in the Terminal theme.
(function initCrtToggle() {
  const root = document.documentElement;
  const button = document.getElementById("crtToggle");
  if (!button) return;
  const sync = () => {
    const isTerminal = root.dataset.theme === "terminal";
    if (!isTerminal) root.classList.remove("terminal-crt");
    const enabled = isTerminal && root.classList.contains("terminal-crt");
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Turn off CRT screen effect" : "Turn on CRT screen effect");
    button.disabled = !isTerminal;
  };
  button.addEventListener("click", () => {
    if (root.dataset.theme !== "terminal") return;
    root.classList.toggle("terminal-crt");
    sync();
  });
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  sync();
})();

const $ = (s) => document.querySelector(s);
const DEFAULT_CATS = ["Discussions/Forums", "Projects", "Learning", "Tools", "Development", "Entertainment", "Social", "Shopping", "Work", "Other"];

const state = {
  items: [],
  meta: {},            // key -> { notes, tags[], category, pinned, displayName }
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
const getMeta = (key) => state.meta[key] || (state.meta[key] = { notes: "", tags: [], category: "Other", pinned: false, displayName: "" });

function displayNameFor(it) {
  const m = getMeta(it.key);
  return (m.displayName && m.displayName.trim()) ? m.displayName.trim() : it.title;
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
      return [it.title, displayNameFor(it), it.url, it.desc, m.notes, m.tags.join(" "), catOf(it)].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => (getMeta(b.key).pinned - getMeta(a.key).pinned) || displayNameFor(a).localeCompare(displayNameFor(b)));
}

/* ---------- Rendering ---------- */
async function loadShots() {
  for (const u of state.shots.values()) URL.revokeObjectURL(u);
  state.shots.clear();
  try {
    for (const [key, val] of await Shots.entries()) state.shots.set(key, URL.createObjectURL(val.blob));
  } catch { /* previews are optional */ }
}

// Real screenshot if available; otherwise use a quiet, theme-aware fallback tile.
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
  const s = shotUrl(it);
  const fallback = icon ? `<img class="big" src="${esc(icon)}" alt="">`
    : `<span class="letter">${esc(it.title[0]?.toUpperCase() || "?")}</span>`;
  const shot = s ? `<img class="shot" ${s.remote ? 'loading="lazy"' : ""} src="${esc(s.src)}" alt="" onerror="this.remove();this.parentElement.classList.remove('has-shot');this.parentElement.classList.add('placeholder')">` : "";
  return `<div class="thumb${s ? " has-shot" : " placeholder"}">${fallback}${shot}</div>`;
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
    const dn = displayNameFor(it);
    return `<article class="card ${it.type === "extension" && !it.enabled ? "disabled" : ""}" data-key="${esc(it.key)}">
      ${thumbHtml(it)}
      <div class="card-body">
        <div class="title-row">${icon ? `<img class="fav" src="${esc(icon)}" alt="">` : ""}<span class="title" title="${esc(it.title)}">${esc(dn)}</span></div>
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
  const dn = displayNameFor(it);
  const panel = $("#panel");
  panel.hidden = false;
  panel.innerHTML = `
    <div class="panel-thumb">
      <button class="panel-close" data-act="close">✕</button>
      ${thumbHtml(it)}
    </div>
    <div class="panel-body">
      <div class="panel-head"><div><div class="t">${esc(dn)}</div><div class="u">${esc(it.url || it.desc)}</div></div></div>
      <div class="panel-actions">
        <button class="btn primary" data-act="open">${it.type === "extension" ? "Settings" : "Open"}</button>
        ${it.type === "extension" ? `<button class="btn" data-act="toggle">${it.enabled ? "Disable" : "Enable"}</button>` : `<button class="btn danger" data-act="delete">Delete</button>`}
      </div>
      <label>
        <span class="field-label"><span>Display name</span><small>Custom label shown on cards (leave empty to use original title)</small></span>
        <input id="displayNameInput" type="text" value="${esc(m.displayName)}" placeholder="Use bookmark title">
      </label>
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
  if (e.target.id === "displayNameInput") {
    getMeta(state.selected).displayName = e.target.value;
    persist(); render();
    // Update panel title live without re-opening
    const it = state.items.find((i) => i.key === state.selected);
    if (it && state.selected) {
      const tEl = document.querySelector(".panel-head .t");
      if (tEl) tEl.textContent = displayNameFor(it);
    }
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
  const title = $("#addTitle").value.trim() || host(url);
  await chrome.bookmarks.create({ title, url });
  const m = getMeta("b:" + url);
  // If a custom name was provided, store it as displayName
  if ($("#addTitle").value.trim()) {
    m.displayName = $("#addTitle").value.trim();
  }
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
$("#reopenSetupBtn").onclick = () => {
  $("#settingsDialog").close();
  const currentTheme = window.linkdeckGetTheme?.() || "light";
  document.querySelectorAll("[data-onboarding-theme]").forEach((card) => {
    const selected = card.dataset.onboardingTheme === currentTheme;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  showOnboardingStep(1);
  $("#firstRunDialog").showModal();
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

$("#autoSortBtn").onclick = async () => {
  const bookmarkCount = state.items.filter((i) => i.type === "bookmark").length;
  if (!bookmarkCount) { $("#autoSortStatus").textContent = "No bookmarks to sort."; return; }
  if (!confirm(`Auto-sort ${bookmarkCount} bookmarks?\n\nThis will assign categories and tags based on each URL's domain and structure.`)) return;

  autoSort();

  const catCounts = {};
  for (const it of state.items) {
    const c = getMeta(it.key).category || "Other";
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  const tagSet = new Set();
  for (const m of Object.values(state.meta)) { if (m.tags) m.tags.forEach((t) => tagSet.add(t)); }

  $("#autoSortStatus").textContent = `Done! Categorized ${bookmarkCount} bookmarks · ${tagSet.size} unique tags added.`;
  persist();
  render();
};

let onboardingStep = 1;
let onboardingPreviewChoice = "none";
function showOnboardingStep(step) {
  onboardingStep = step;
  document.querySelectorAll("[data-onboarding-step]").forEach((el) => {
    el.hidden = Number(el.dataset.onboardingStep) !== step;
  });
  const labels = { 1: "1 / 4", 2: "2 / 4", 3: "3 / 4", 4: "4 / 4" };
  const stageLabels = { 1: "THE LOOK COMES FIRST", 2: "MAKE IT YOURS", 3: "YOUR ORGANIZING STYLE", 4: "READY WHEN YOU ARE" };
  $("#onboardingProgress").textContent = labels[step];
  $("#onboardingStageLabel").textContent = stageLabels[step];
  $("#onboardingTitle").textContent = step === 1 ? "Make LinkDeck yours." : step === 4 ? "You're all set." : "A couple quick preferences.";
  $("#onboardingBack").hidden = step === 1;
  $("#onboardingNext").textContent = step === 1 ? "Choose this look →" : step === 4 ? "Start organizing →" : "Continue →";
}

document.querySelectorAll("[data-onboarding-theme]").forEach((card) => {
  card.addEventListener("click", () => {
    const theme = card.dataset.onboardingTheme;
    window.linkdeckSetTheme?.(theme);
    document.querySelectorAll("[data-onboarding-theme]").forEach((other) => {
      const selected = other === card;
      other.classList.toggle("selected", selected);
      other.setAttribute("aria-pressed", String(selected));
    });
  });
});

$("#onboardingBack").onclick = () => showOnboardingStep(Math.max(1, onboardingStep - 1));
$("#onboardingNext").onclick = async () => {
  if (onboardingStep === 1) {
    const selectedTheme = document.querySelector('[data-onboarding-theme][aria-pressed="true"]')?.dataset.onboardingTheme || "light";
    window.linkdeckSetTheme?.(selectedTheme);
    showOnboardingStep(2);
    return;
  }
  if (onboardingStep === 2) {
    const choice = document.querySelector('input[name="previewChoice"]:checked')?.value || "none";
    onboardingPreviewChoice = choice;
    state.settings.previews = choice === "online";
    // Local screenshots are intentionally captured on demand from Settings, not silently during setup.
    state.settings.localShots = false;
    $("#onboardingPermissionNote").hidden = true;
    $("#onboardingPreviewSummary").textContent = choice === "online"
      ? "Thumbnails will use the online preview service. You can switch this off in Settings."
      : choice === "local"
        ? "When you’re ready, open Settings → Generate previews now to capture screenshots locally. LinkDeck will ask for page access at that point."
        : "You chose no previews. LinkDeck will use the clean icon-based thumbnails.";
    persist();
    render();
    showOnboardingStep(3);
    return;
  }
  if (onboardingStep === 3) {
    const wantsSort = document.querySelector('input[name="sortChoice"]:checked')?.value === "yes";
    const bookmarkCount = state.items.filter((i) => i.type === "bookmark").length;
    if (wantsSort && bookmarkCount) {
      autoSort();
      const tagSet = new Set();
      for (const m of Object.values(state.meta)) if (m.tags) m.tags.forEach((t) => tagSet.add(t));
      $("#onboardingSortSummary").textContent = `Organized ${bookmarkCount} bookmarks and added ${tagSet.size} unique tags.`;
    } else if (wantsSort) {
      $("#onboardingSortSummary").textContent = "There are no bookmarks to sort yet. You can add some anytime.";
    } else {
      $("#onboardingSortSummary").textContent = "No automatic changes made. You can sort or edit everything yourself.";
    }
    persist();
    render();
    showOnboardingStep(4);
    return;
  }
  await chrome.storage.local.set({ linkdeckFirstRunDone: true });
  $("#firstRunDialog").close();
  render();
};

$("#firstRunLater").onclick = async () => {
  await chrome.storage.local.set({ linkdeckFirstRunDone: true });
  $("#firstRunDialog").close();
};

/* ---------- Auto-sort helpers ---------- */
const DOMAIN_CATS = [
  { patterns: ["youtube.com", "vimeo.com", "twitch.tv", "netflix.com", "hulu.com", "disneyplus.com", "spotify.com"], category: "Entertainment" },
  { patterns: ["twitter.com", "x.com", "linkedin.com", "facebook.com", "instagram.com", "tiktok.com", "mastodon.social"], category: "Social" },
  { patterns: ["amazon.com", "shopify.com", "ebay.com", "etsy.com", "walmart.com", "target.com"], category: "Shopping" },
  { patterns: ["gmail.com", "outlook.com", "mail.google.com", "proton.me"], category: "Work" },
  { patterns: ["drive.google.com", "docs.google.com", "sheets.google.com", "dropbox.com", "onedrive.live.com", "notion.so", "linear.app", "figma.com", "slack.com", "discord.com", "jira.atlassian.net", "confluence"], category: "Work" },
  { patterns: ["wikipedia.org", "w3.org", "caniuse.com", "pub.dev", "golang.org", "rust-lang.org", "python.org"], category: "Learning" },
];

const DOMAIN_TAGS = [
  { patterns: ["github.com", "gitlab.com", "bitbucket.org"], tags: ["code", "vcs"] },
  { patterns: ["youtube.com"], tags: ["video", "tutorials"] },
  { patterns: ["stackoverflow.com"], tags: ["qa", "coding-help"] },
  { patterns: ["twitter.com", "x.com"], tags: ["social", "microblog"] },
  { patterns: ["reddit.com"], tags: ["community", "forums"] },
  { patterns: ["netflix.com", "hulu.com"], tags: ["streaming"] },
  { patterns: ["medium.com", "dev.to"], tags: ["articles", "tech-blog"] },
];

const DISCUSSION_KEYWORDS = ["forum", "discussion", "community", "board", "threads", "conversation", "comments", "review", "reviews"];
const PROJECT_KEYWORDS = ["project", "projects", "repository", "repos", "repo", "workspace", "workspace", "site:demo", "live-demo", "showcase", "portfolio", "hackathon", "open-source", "oss", "challenge", "competition"];
const LEARNING_KEYWORDS = ["blog", "articles", "tutorial", "learn", "academy", "course", "lesson", "guide", "handbook", "manual", "documentation", "docs", "wiki", "notes"];
const TOOL_KEYWORDS = ["converter", "calculator", "editor", "compress", "resize", "crop", "trim", "viewer", "format", "generator", "builder", "maker", "creator", "previewer", "linter", "formatter", "beautifier", "minifier", "validator"];

function inferCategory(url) {
  if (!url || !/^https?:/.test(url)) return null;

  // Priority 1: Discussions/Forums — path keywords first (questions, community, forum, etc.)
  const lowerUrl = url.toLowerCase();
  for (const kw of DISCUSSION_KEYWORDS) {
    if (lowerUrl.includes(kw)) return "Discussions/Forums";
  }
  // Also check hostname for known question/community sites
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const discussionHosts = [
      "stackoverflow.com", "superuser.com", "serverfault.com", "askubuntu.com",
      "quora.com", "groups.google.com", "discourse.org",
      "talk.google.com", "forums.",
    ];
    for (const dh of discussionHosts) { if (host.includes(dh)) return "Discussions/Forums"; }
  } catch {}

  // Priority 2: Projects — path keywords or known project hosts
  for (const pk of PROJECT_KEYWORDS) {
    if (lowerUrl.includes(pk)) return "Projects";
  }
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const projPaths = ["org", "repos", "repo", "pulled", "pull-request", "pr/", "issues", "settings"];
    for (const pp of projPaths) { if (u.pathname.split("/").some(p => p.toLowerCase() === pp)) return "Projects"; }
    const projectHosts = ["github.com", "gitlab.com", "bitbucket.org", "heroku.com", "vercel.com", "netlify.app", "railway.app", "render.com", "codepen.io", "jsfiddle.net", "codesandbox.io", "replit.com", "glitch.com"];
    for (const ph of projectHosts) { if (host === ph || host.endsWith("." + ph)) return "Projects"; }
  } catch {}

  // Priority 3: Learning — path keywords or known learning hosts
  for (const lk of LEARNING_KEYWORDS) {
    if (lowerUrl.includes(lk)) return "Learning";
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const learnHosts = [
      "medium.com", "dev.to", "css-tricks.com", "freecodecamp.org", "coursera.org", "udemy.com",
      "edx.org", "kaggle.com", "hackernoon.com", "substack.com", "beebom.com", "howtogeek.com",
      "lifehacker.com", "arxiv.org", "researchgate.net", "scholar.google.com", "w3schools.com",
    ];
    for (const lh of learnHosts) { if (host === lh || host.endsWith("." + lh)) return "Learning"; }
  } catch {}

  // Priority 4: Tools — path keywords or known tool hosts
  for (const tk of TOOL_KEYWORDS) {
    if (lowerUrl.includes(tk)) return "Tools";
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const toolHosts = [
      "iloveimg.com", "tinypng.com", "compress2go.com", "smallpdf.com", "pdf24.org",
      "remove.bg", "clideo.com", "kapwing.com", "handbrake.fr",
      "convertio.co", " Zamzar", "online-convert.com",
      "jsonformatter.org", "regex101.com", "tableconvert.com",
      "imgbb.com", "imgur.com", "giphy.com",
      "canva.com", "photoshop.com", "inkscape.org",
    ];
    for (const th of toolHosts) { if (host === th || host.endsWith("." + th)) return "Tools"; }
  } catch {}

  // Fallback: known domain→category mapping
  for (const entry of DOMAIN_CATS) {
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    for (const p of entry.patterns) {
      if (host.includes(p.toLowerCase()) || url.toLowerCase().includes(p.toLowerCase())) return entry.category;
    }
  }
  return null;
}

function inferTags(url) {
  if (!url || !/^https?:/.test(url)) return [];
  const tags = [];
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    for (const entry of DOMAIN_TAGS) {
      for (const p of entry.patterns) {
        if (host.includes(p.toLowerCase()) || url.toLowerCase().includes(p.toLowerCase())) { tags.push(...entry.tags); break; }
      }
    }
  } catch {}
  try {
    const u = new URL(url);
    // Extract path segments as potential tags
    u.pathname.split("/").filter(Boolean).forEach((seg) => {
      const clean = seg.replace(/[^a-z0-9-]/gi, "").toLowerCase();
      if (clean.length > 2 && clean.length < 30 && !tags.includes(clean)) tags.push(clean);
    });
    // Add domain-based tag for common services
    const domainTag = u.hostname.replace(/^www\./, "").split(".")[0];
    if (!tags.includes(domainTag) && domainTag.length > 2) tags.push(domainTag);
  } catch {}
  return [...new Set(tags)]; // unique
}

function autoSort(progressCb) {
  let processed = 0;
  const total = state.items.filter((i) => i.type === "bookmark").length;
  for (const it of state.items) {
    if (it.type !== "bookmark") continue;
    const m = getMeta(it.key);
    if (!m.category || m.category === "Other" || m.category === "") {
      const inferred = inferCategory(it.url);
      if (inferred) m.category = inferred;
    }
    if (!m.tags?.length) {
      const inferredTags = inferTags(it.url);
      if (inferredTags.length) {
        for (const t of inferredTags) {
          if (!m.tags.includes(t)) m.tags.push(t);
        }
      }
    }
    processed++;
    progressCb?.(processed, total);
  }
  persist();
}

/* ---------- Init ---------- */
async function refresh() { await loadItems(); render(); if (state.selected) openPanel(state.selected); }

(async function init() {
  const saved = await chrome.storage.local.get(["meta", "cats", "settings"]);
  if (saved.meta) state.meta = saved.meta;
  if (saved.cats) state.cats = saved.cats;
  if (saved.settings) Object.assign(state.settings, saved.settings);
  await loadShots();
  await refresh();

  // Show first-run prompt if this is the user's first time opening LinkDeck
  const { linkdeckFirstRunDone } = await chrome.storage.local.get("linkdeckFirstRunDone");
  if (!linkdeckFirstRunDone) {
    const currentTheme = window.linkdeckGetTheme?.() || "light";
    document.querySelectorAll("[data-onboarding-theme]").forEach((card) => {
      const selected = card.dataset.onboardingTheme === currentTheme;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    showOnboardingStep(1);
    $("#firstRunDialog").showModal();
  }

  for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) chrome.bookmarks[ev].addListener(() => refresh());
  chrome.management.onInstalled.addListener(refresh);
  chrome.management.onUninstalled.addListener(refresh);
})();
