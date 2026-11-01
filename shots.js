// Tiny IndexedDB store for page previews. Shared by the service worker (importScripts) and the dashboard (<script>).
const Shots = (() => {
  let dbp;
  const db = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("mylinks-shots", 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("shots")) d.createObjectStore("shots");
      if (!d.objectStoreNames.contains("custom-thumbnails")) d.createObjectStore("custom-thumbnails");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const runStore = async (store, mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  const run = (mode, fn) => runStore("shots", mode, fn);
  return {
    // Same page regardless of #hash or trailing slash.
    norm(u) { try { const x = new URL(u); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return u; } },
    get: (key) => run("readonly", (s) => s.get(key)),
    put: (key, blob) => run("readwrite", (s) => s.put({ blob, ts: Date.now() }, key)),
    clear: () => run("readwrite", (s) => s.clear()),
    getCustom: (key) => runStore("custom-thumbnails", "readonly", (s) => s.get(key)),
    putCustom: (key, blob) => runStore("custom-thumbnails", "readwrite", (s) => s.put({ blob, ts: Date.now() }, key)),
    deleteCustom: (key) => runStore("custom-thumbnails", "readwrite", (s) => s.delete(key)),
    async customEntries() {
      const d = await db();
      return new Promise((res, rej) => {
        const out = [];
        const r = d.transaction("custom-thumbnails").objectStore("custom-thumbnails").openCursor();
        r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
        r.onerror = () => rej(r.error);
      });
    },
    async entries() {
      const d = await db();
      return new Promise((res, rej) => {
        const out = [];
        const r = d.transaction("shots").objectStore("shots").openCursor();
        r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
        r.onerror = () => rej(r.error);
      });
    },
  };
})();
