const fs = require('fs');
const path = require('path');
const env = require('./env');

// Minimal Firestore-shaped store backed by a single JSON file, so the agent
// engine (ported from the SuperSpeech backend, which used Firestore) runs
// with zero external services. Swap this module for a real DB later by
// keeping the same collection()/doc() API.
//
// NOTE: Render's filesystem is ephemeral - for durable lead history attach a
// Render Disk and point STORE_FILE at it, or back this with Postgres.

const DATA_FILE = env.STORE_FILE || path.join(__dirname, '..', '..', 'data', 'store.json');

let state = { seq: 0, collections: {} };
let saveTimer = null;

function load() {
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    state.collections = state.collections || {};
  } catch {
    state = { seq: 0, collections: {} };
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.warn('[store] persist failed:', e.message);
    }
  }, 50);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

load();

function makeDocRef(collName, id) {
  return {
    update: async (patch) => {
      const coll = state.collections[collName] || {};
      if (coll[id]) { Object.assign(coll[id], flattenPatch(patch)); save(); }
    },
    set: async (data, opts) => {
      state.collections[collName] = state.collections[collName] || {};
      state.collections[collName][id] = opts && opts.merge
        ? { ...(state.collections[collName][id] || {}), ...data }
        : data;
      save();
    }
  };
}

// Supports 'a.b.c' update paths the way Firestore dot-paths do.
function flattenPatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k.includes('.')) {
      // top-level merge for the one-level dot paths we actually use
      const [head, ...rest] = k.split('.');
      out[head] = out[head] || {};
      let cur = out[head];
      for (let i = 0; i < rest.length - 1; i++) cur = cur[rest[i]] = cur[rest[i]] || {};
      cur[rest[rest.length - 1]] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function snapshot(collName, filters, orderField, orderDir, lim) {
  const coll = state.collections[collName] || {};
  let docs = Object.entries(coll)
    .map(([id, data]) => ({ id, data: () => data, ref: makeDocRef(collName, id), exists: true }));

  for (const [field, val] of filters) {
    docs = docs.filter(d => d.data()[field] === val);
  }
  if (orderField) {
    docs.sort((a, b) => {
      const av = a.data()[orderField] || '', bv = b.data()[orderField] || '';
      return orderDir === 'desc' ? (av < bv ? 1 : av > bv ? -1 : 0)
                                 : (av > bv ? 1 : av < bv ? -1 : 0);
    });
  }
  if (lim) docs = docs.slice(0, lim);
  return { docs, empty: docs.length === 0, size: docs.length };
}

class Query {
  constructor(collName) {
    this.collName = collName;
    this.filters = [];
    this.orderField = null;
    this.orderDir = 'asc';
    this.lim = null;
  }
  where(field, op, val) {
    if (op !== '==') throw new Error('store: only == supported');
    this.filters.push([field, val]);
    return this;
  }
  orderBy(field, dir) { this.orderField = field; this.orderDir = dir || 'asc'; return this; }
  limit(n) { this.lim = n; return this; }
  async get() { return snapshot(this.collName, this.filters, this.orderField, this.orderDir, this.lim); }
}

const db = {
  collection(name) {
    const q = new Query(name);
    return {
      where: (f, o, v) => q.where(f, o, v),
      orderBy: (f, d) => q.orderBy(f, d),
      limit: (n) => q.limit(n),
      get: () => q.get(),
      add: async (data) => {
        state.collections[name] = state.collections[name] || {};
        const id = `doc_${Date.now().toString(36)}_${(++state.seq).toString(36)}`;
        state.collections[name][id] = data;
        save();
        return { id };
      },
      doc: (id) => ({
        get: async () => {
          const data = (state.collections[name] || {})[id];
          return { exists: !!data, data: () => data, id };
        },
        set: (data, opts) => makeDocRef(name, id).set(data, opts),
        update: (patch) => makeDocRef(name, id).update(patch)
      })
    };
  }
};

module.exports = { db };
