/* =========================================================
   db.js — IndexedDB wrapper
   Stores: games (speedrun categories), runs (attempts/history),
           media (games/movies/books backlog)
   ========================================================= */
const DB_NAME = 'runlogDB';
const DB_VERSION = 1;
const STORES = ['games', 'runs', 'media'];

let _dbInstance = null;

function openDB() {
  if (_dbInstance) return Promise.resolve(_dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('games')) {
        db.createObjectStore('games', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('runs')) {
        const runsStore = db.createObjectStore('runs', { keyPath: 'id' });
        runsStore.createIndex('gameId', 'gameId', { unique: false });
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { _dbInstance = e.target.result; resolve(_dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}

const DB = {
  async getAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async get(store, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getByIndex(store, indexName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async put(store, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  },

  async delete(store, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteWhere(store, indexName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.openCursor(IDBKeyRange.only(value));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async clear(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async clearAll() {
    for (const s of STORES) await this.clear(s);
  },

  async exportAll() {
    const data = { app: 'runlog', version: DB_VERSION, exportedAt: new Date().toISOString() };
    for (const s of STORES) { data[s] = await this.getAll(s); }
    return data;
  },

  // mode: 'replace' wipes everything first. 'merge' keeps existing rows and
  // skips any incoming row whose id already exists.
  async importAll(data, mode) {
    if (mode === 'replace') await this.clearAll();
    for (const s of STORES) {
      const rows = Array.isArray(data[s]) ? data[s] : [];
      for (const row of rows) {
        if (mode === 'merge') {
          const existing = await this.get(s, row.id);
          if (existing) continue;
        }
        await this.put(s, row);
      }
    }
  }
};

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

/* =========================================================
   Shared utils
   ========================================================= */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Formats a non-negative duration in ms as M:SS.CC or H:MM:SS.CC
function formatClock(ms) {
  const a = Math.max(0, Math.round(ms));
  const cs = Math.floor((a % 1000) / 10);
  const s = Math.floor((a / 1000) % 60);
  const m = Math.floor((a / 60000) % 60);
  const h = Math.floor(a / 3600000);
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
  return `${m}:${pad2(s)}.${pad2(cs)}`;
}

// Formats a signed delta in ms as +M:SS.CC / -M:SS.CC
function formatDelta(ms) {
  const sign = ms < 0 ? '-' : '+';
  return sign + formatClock(Math.abs(ms));
}

const _brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function formatBRL(value) { return _brl.format(Number(value) || 0); }

function formatDateBR(isoDateOrString) {
  if (!isoDateOrString) return '';
  const d = new Date(isoDateOrString);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

let _toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}