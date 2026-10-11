// Tiny IndexedDB store for page previews. Shared by the service worker (importScripts) and the dashboard (<script>).
const Shots = (() => {
  let dbp;
  const db = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("mylinks-shots", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("shots");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction("shots", mode);
      const req = fn(t.objectStore("shots"));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    // Same page regardless of #hash or trailing slash.
    norm(u) { try { const x = new URL(u); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return u; } },
    get: (key) => run("readonly", (s) => s.get(key)),
    put: (key, blob) => run("readwrite", (s) => s.put({ blob, ts: Date.now() }, key)),
    clear: () => run("readwrite", (s) => s.clear()),
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
