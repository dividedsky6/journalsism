/* Journalism storage: one IndexedDB object store of entries, keyed by entry id.
 * Data stays in this browser on this device. Swap this file for a server-backed
 * version later (same three methods) to sync across devices. */
window.JournalStore = {
  async open() {
    if (!window.indexedDB) throw new Error('IndexedDB is not available');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('journalism', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('entries', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Ask the browser not to clear our data under storage pressure.
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}

    const run = (mode, fn) => new Promise((resolve, reject) => {
      const tx = db.transaction('entries', mode);
      const req = fn(tx.objectStore('entries'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    return {
      /** Every entry, each with its id. */
      all: () => run('readonly', s => s.getAll()),
      /** Create or replace one entry. */
      put: (id, entry) => run('readwrite', s => s.put({ ...entry, id })),
      /** Remove one entry. */
      delete: id => run('readwrite', s => s.delete(id)),
    };
  },
};
