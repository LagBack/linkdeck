importScripts("shots.js");

const STALE_MS = 7 * 24 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasHostAccess = () => chrome.permissions.contains({ origins: ["<all_urls>"] });
const batchTabs = new Set(); // tabs opened by "Generate previews" (skip the on-visit capture for them)
let cancelBatch = false;

// Toolbar icon opens (or focuses) the dashboard.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("dashboard.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

/* ---------- Which URLs are bookmarked? ---------- */
let bookmarkSet = null;
async function isBookmarked(url) {
  if (!bookmarkSet) {
    bookmarkSet = new Set();
    const walk = (nodes) => nodes.forEach((n) => (n.url ? bookmarkSet.add(Shots.norm(n.url)) : n.children && walk(n.children)));
    walk(await chrome.bookmarks.getTree());
  }
  return bookmarkSet.has(Shots.norm(url));
}
for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved"]) chrome.bookmarks[ev].addListener(() => (bookmarkSet = null));

/* ---------- Capture ---------- */
async function shrink(dataUrl) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const w = 560, h = 350; // 16:10, top of the page
  const srcH = Math.min(bmp.height, Math.round((bmp.width * h) / w));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bmp, 0, 0, bmp.width, srcH, 0, 0, w, h);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
}

async function captureWindow(windowId, url) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 });
  await Shots.put(Shots.norm(url), await shrink(dataUrl));
  chrome.runtime.sendMessage({ type: "shot-saved" }).catch(() => {});
}

// Capture bookmarked pages as you browse them.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  try {
    if (info.status !== "complete" || !tab.active || tab.incognito || batchTabs.has(tabId)) return;
    if (!/^https?:/.test(tab.url || "")) return;
    const { settings } = await chrome.storage.local.get("settings");
    if (!settings?.localShots || !(await hasHostAccess()) || !(await isBookmarked(tab.url))) return;

    const existing = await Shots.get(Shots.norm(tab.url));
    if (existing && Date.now() - existing.ts < STALE_MS) return;

    await sleep(1500); // let the page finish painting
    const [cur] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (!cur || cur.id !== tabId || Shots.norm(cur.url) !== Shots.norm(tab.url)) return;
    await captureWindow(tab.windowId, tab.url);
  } catch (err) {
    console.debug("LinkDeck: capture skipped", err);
  }
});

/* ---------- Batch: "Generate previews now" ---------- */
function waitForLoad(tabId, timeout) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function captureAll(urls) {
  cancelBatch = false;
  let done = 0;
  for (const url of urls) {
    if (cancelBatch) break;
    let win;
    try {
      win = await chrome.windows.create({ url, type: "popup", width: 1280, height: 800, focused: false });
      const tabId = win.tabs[0].id;
      batchTabs.add(tabId);
      await waitForLoad(tabId, 15000);
      await sleep(1500);
      await captureWindow(win.id, url);
    } catch (err) {
      console.debug("LinkDeck: batch capture failed for", url, err);
    } finally {
      if (win?.id) chrome.windows.remove(win.id).catch(() => {});
      if (win?.tabs?.[0]) batchTabs.delete(win.tabs[0].id);
    }
    done++;
    chrome.runtime.sendMessage({ type: "capture-progress", done, total: urls.length }).catch(() => {});
  }
  chrome.runtime.sendMessage({ type: "capture-progress", done, total: urls.length, finished: true }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "capture-all") captureAll(msg.urls || []);
  if (msg?.type === "cancel-capture") cancelBatch = true;
});
