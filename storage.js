/* Journalism storage: IndexedDB in this browser, on this device.
 *   entries  – one record per entry, keyed by id
 *   journals – one record per journal ({name, color, created}), keyed by name
 * Swap this file for a server-backed version later (same methods) to sync across devices. */
window.JournalStore = {
  async open() {
    if (!window.indexedDB) throw new Error('IndexedDB is not available');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('journalism', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('journals')) d.createObjectStore('journals', { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Ask the browser not to clear our data under storage pressure.
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}

    const run = (name, mode, fn) => new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const req = fn(tx.objectStore(name));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    return {
      /** Every entry, each with its id. */
      all: () => run('entries', 'readonly', s => s.getAll()),
      /** Create or replace one entry. */
      put: (id, entry) => run('entries', 'readwrite', s => s.put({ ...entry, id })),
      /** Remove one entry. */
      delete: id => run('entries', 'readwrite', s => s.delete(id)),
      /** Every journal's settings. */
      journals: () => run('journals', 'readonly', s => s.getAll()),
      /** Create or replace a journal's settings. */
      putJournal: j => run('journals', 'readwrite', s => s.put(j)),
      /** Remove a journal's settings (not its entries). */
      deleteJournal: name => run('journals', 'readwrite', s => s.delete(name)),
    };
  },
};
