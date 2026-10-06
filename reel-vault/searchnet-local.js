/* ─────────────────────────────────────────────────────────────────
 *  SearchNet local backend — runs entirely in the browser.
 *
 *  It mimics the PC server's HTTP API (same paths, same JSON shapes) but
 *  stores everything in IndexedDB on THIS device and collects videos through
 *  the user's own Cloudflare Worker. No server, no account, nothing tracked.
 *
 *  The app talks to it exactly like the server: Local.request(path, opts).
 *  Topic learning is layered on in searchnet-learn.js (loaded alongside).
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── IndexedDB (tiny promise wrapper) ──────────────────────────
  const DB_NAME = 'searchnet', DB_VER = 1;
  let _db = null;
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('topics')) db.createObjectStore('topics', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('votes')) db.createObjectStore('votes', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      };
      r.onsuccess = () => { _db = r.result; res(_db); };
      r.onerror = () => rej(r.error);
    });
  }
  function tx(store, mode) { return openDB().then((db) => db.transaction(store, mode).objectStore(store)); }
  const idb = {
    async get(store, key) { const s = await tx(store, 'readonly'); return new Promise((res) => { const r = s.get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); },
    async all(store) { const s = await tx(store, 'readonly'); return new Promise((res) => { const r = s.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); },
    async put(store, val) { const s = await tx(store, 'readwrite'); return new Promise((res, rej) => { const r = s.put(val); r.onsuccess = () => res(val); r.onerror = () => rej(r.error); }); },
    async putMany(store, vals) { const s = await tx(store, 'readwrite'); return new Promise((res, rej) => { vals.forEach((v) => s.put(v)); s.transaction.oncomplete = () => res(vals.length); s.transaction.onerror = () => rej(s.transaction.error); }); },
    async del(store, key) { const s = await tx(store, 'readwrite'); return new Promise((res) => { const r = s.delete(key); r.onsuccess = () => res(true); r.onerror = () => res(false); }); },
    async clear(store) { const s = await tx(store, 'readwrite'); return new Promise((res) => { const r = s.clear(); r.onsuccess = () => res(true); r.onerror = () => res(false); }); },
  };

  // ── settings (kv) ─────────────────────────────────────────────
  const DEFAULT_SETTINGS = { worker_url: '', worker_key: '', synonyms: null,
    semantic: false, web_expansion: false, embed_model: '' };
  let SET = null;
  async function settings() {
    if (SET) return SET;
    const row = await idb.get('kv', 'settings');
    SET = Object.assign({}, DEFAULT_SETTINGS, (row && row.v) || {});
    return SET;
  }
  async function saveSettings(patch) {
    const s = await settings();
    Object.assign(s, patch);
    await idb.put('kv', { k: 'settings', v: s });
    return s;
  }

  // ── synonyms ──────────────────────────────────────────────────
  let SYN = [];
  async function loadSyn() {
    const s = await settings();
    if (s.synonyms) { SYN = s.synonyms; return SYN; }
    try { SYN = (await (await fetch('server/synonyms.json')).json()).groups || []; }
    catch (e) { SYN = []; }
    return SYN;
  }

  // ── search engine (ported from the server's FTS search) ───────
  const W = { text: 1, hashtags: 2, author: 1.5, transcript: .8, ocr: .6, tags: 2.5 };
  const stem = (w) => w.replace(/(ings?|edly|ed|es|s|ly)$/, '') || w;
  function lev(a, b) { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  const fieldsOf = (it) => ({ text: it.text || '', hashtags: it.hashtags || '', author: (it.author || '') + ' ' + (it.author_name || ''), transcript: it.transcript || '', ocr: it.ocr || '', tags: it.tags || '' });
  function synMap() { const m = {}; for (const g of SYN) for (const w of g) { m[w] = m[w] || new Set(); g.forEach((x) => x !== w && m[w].add(x)); } return m; }

  function runSearch(items, p) {
    const P = Object.fromEntries(new URLSearchParams(p));
    const flag = (k) => (P[k] ?? '1') === '1';
    const syn = synMap();
    const vocab = new Set();
    items.forEach((it) => Object.values(fieldsOf(it)).join(' ').toLowerCase().split(/[^\p{L}\p{N}_]+/u).forEach((w) => w.length > 2 && vocab.add(w)));
    const re = /(-?)(?:([A-Za-z_]+):)?(?:"([^"]*)"|(\S+))/g; let m; const terms = [], fa = []; let any = P.mode === 'any';
    while ((m = re.exec(P.q || ''))) {
      const neg = m[1] === '-'; let text = m[3] !== undefined ? m[3] : m[4]; let col = null;
      if (text === 'OR') { any = true; continue; }
      if (text[0] === '@' && text.length > 1) { fa.push([neg, text.slice(1).toLowerCase()]); continue; }
      if (text[0] === '#' && text.length > 1) { text = text.slice(1); col = 'hashtags'; }
      const f = { said: 'transcript', screen: 'ocr', text: 'text' }[(m[2] || '').toLowerCase()]; if (f) col = f;
      const words = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []; if (!words.length) continue;
      const raw = words.join(' '), phrase = m[3] !== undefined || words.length > 1;
      const syns = !neg && flag('synonyms') ? [...(syn[raw] || [])] : [];
      const fuzzy = !neg && !phrase && flag('fuzzy') && raw.length >= 4 ? [...vocab].filter((v) => v !== raw && stem(v) !== stem(raw) && lev(v, raw) <= (raw.length > 6 ? 2 : 1)).slice(0, 4) : [];
      terms.push({ neg, raw, phrase, col, variants: [raw, ...syns, ...fuzzy], prefix: !phrase && flag('partial'), syns, fuzzy });
    }
    const cols = (P.fields || '').split(',').filter(Boolean);
    const score = (it, t) => { const F = fieldsOf(it); let s = 0; const use = t.col ? (t.col === 'hashtags' ? ['hashtags', 'tags'] : [t.col]) : (cols.length ? cols : Object.keys(F)); for (const c of use) { const low = (F[c] || '').toLowerCase(); const ws = low.split(/[^\p{L}\p{N}_]+/u); for (const v of t.variants) { if (v.includes(' ') || t.phrase) { if (low.includes(v)) s += W[c]; continue; } const sv = stem(v); for (const w of ws) if (w && (w === v || stem(w) === sv || (t.prefix && w.startsWith(v)))) s += W[c]; } } return s; };
    const has = (v, x) => (' ' + (v || '').toLowerCase() + ' ').includes(' ' + x + ' ');
    let rows = items.map((it) => {
      const pos = terms.filter((t) => !t.neg);
      if (terms.some((t) => t.neg && score(it, t) > 0)) return null;
      let sc = 0; if (pos.length) { const ss = pos.map((t) => score(it, t)); if (any ? !ss.some((x) => x > 0) : ss.some((x) => x === 0)) return null; sc = ss.reduce((a, b) => a + b, 0); }
      for (const [n, a] of fa) if (((it.author + ' ' + it.author_name).toLowerCase().includes(a)) === n) return null;
      if (P.platform && !P.platform.split(',').includes(it.platform)) return null;
      if (P.media && !P.media.split(',').includes(it.media || 'video')) return null;
      if (P.author && !(it.author + ' ' + it.author_name).toLowerCase().includes(P.author.toLowerCase().replace(/^@/, ''))) return null;
      if (P.hashtag && !P.hashtag.split(',').every((h) => has(it.hashtags, h.replace(/^#/, '')))) return null;
      if (P.tag && !P.tag.split(',').every((t) => has(it.tags, t))) return null;
      if (P.date_from && it.posted_at < Date.parse(P.date_from) / 1000) return null;
      if (P.date_to && it.posted_at > Date.parse(P.date_to) / 1000 + 86399) return null;
      if (P.dur_min && it.duration < +P.dur_min) return null;
      if (P.dur_max && it.duration > +P.dur_max) return null;
      if (P.likes_min && it.likes < +P.likes_min) return null;
      if (P.views_min && it.views < +P.views_min) return null;
      if (P.has_file === '1') return null;        // nothing is downloaded in browser mode
      if (P.has_speech === '1' && !it.transcript) return null;
      if (P.starred === '1' && !it.starred) return null;
      if (P.shape === 'portrait' && !(it.height > it.width * 1.1)) return null;
      if (P.shape === 'landscape' && !(it.width > it.height * 1.1)) return null;
      if (P.shape === 'square' && !(it.width > 0 && Math.abs(it.width - it.height) <= it.width * 0.1)) return null;
      return Object.assign({}, it, { _s: sc });
    }).filter(Boolean);
    const SO = { newest: (a, b) => (b.posted_at || 0) - (a.posted_at || 0), oldest: (a, b) => (a.posted_at || 0) - (b.posted_at || 0), likes: (a, b) => b.likes - a.likes, views: (a, b) => b.views - a.views, engagement: (a, b) => (b.likes + 2 * b.reposts) - (a.likes + 2 * a.reposts), longest: (a, b) => b.duration - a.duration, shortest: (a, b) => a.duration - b.duration, collected: (a, b) => (b.collected_at || 0) - (a.collected_at || 0) };
    rows.sort(SO[P.sort] || ((a, b) => (b._s - a._s) || ((b.posted_at || 0) - (a.posted_at || 0))));
    const count = (k, split) => { const c = {}; rows.forEach((r) => (split ? (r[k] || '').toLowerCase().split(/\s+/) : [r[k]]).filter(Boolean).forEach((v) => c[v] = (c[v] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([value, cnt]) => ({ value, count: cnt })); };
    const off = +P.offset || 0, lim = +P.limit || 40, hlw = new Set();
    terms.filter((t) => !t.neg).forEach((t) => { hlw.add(t.raw); t.syns.forEach((x) => hlw.add(x)); t.fuzzy.forEach((x) => hlw.add(x)); });
    return { total: rows.length, items: rows.slice(off, off + lim), offset: off, limit: lim, highlight: [...hlw],
      expansions: terms.map((t) => ({ term: t.raw, synonyms: t.syns, fuzzy: t.fuzzy, neg: t.neg })),
      facets: { platform: count('platform'), hashtag: count('hashtags', true), tag: count('tags', true), author: count('author'), media: count('media') } };
  }

  // ── collecting through the user's Worker ──────────────────────
  const WORKER_SOURCES = [
    { preset: 'mastodon', name: 'Mastodon hashtag', source: 'mastodon', param: 'instance', param_default: 'mastodon.social', searchable: true },
    { preset: 'lemmy', name: 'Lemmy search', source: 'lemmy', param: 'instance', param_default: 'lemmy.world', searchable: true },
    { preset: 'reddit', name: 'Reddit search', source: 'reddit', searchable: true },
    { preset: 'bluesky', name: 'Bluesky search', source: 'bluesky', searchable: true },
    { preset: 'youtube', name: 'YouTube search', source: 'youtube', searchable: true },
    { preset: 'rss', name: 'RSS / channel feed', source: 'rss', param: 'url', searchable: false },
  ];
  async function workerCall(path) {
    const s = await settings();
    if (!s.worker_url) throw new Error('Set your Cloudflare Worker URL in SOURCES first');
    const base = s.worker_url.replace(/\/$/, '');
    const r = await fetch(base + path + (s.worker_key ? (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(s.worker_key) : ''),
      { headers: s.worker_key ? { 'X-SN-Key': s.worker_key } : {} });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('Worker HTTP ' + r.status));
    return j;
  }
  async function collect(body, job) {
    const srcs = (body.source_ids && body.source_ids.length)
      ? (await listSources()).filter((s) => body.source_ids.includes(s.id))
      : (await listSources()).filter((s) => s.enabled && s.searchable);
    const queries = (body.queries || []).filter((q) => q && q.trim());
    const limit = Math.min(body.limit || 30, 200);
    const seen = new Set();
    let found = 0, added = 0;
    job.total = Math.max(1, queries.length * srcs.length);
    for (const q of queries) {
      for (const s of srcs) {
        if (job.cancel) break;
        try {
          const params = new URLSearchParams({ source: s.source, q, limit, media: body.media || 'video' });
          if (s.param === 'instance' && s.value) params.set('instance', s.value);
          job.log('▶ ' + s.name + ' · ' + q);
          const r = await workerCall('/search?' + params);
          const items = (r.items || []).filter((it) => it && it.id && !seen.has(it.id));
          for (const it of items) {
            seen.add(it.id);
            it.collected_at = Math.floor(Date.now() / 1000);
            if (!(await idb.get('items', it.id))) added++;
            await idb.put('items', it);
            found++;
          }
          job.log('  ' + items.length + ' from ' + s.name);
        } catch (e) { job.stats.errors++; job.log('  ✕ ' + s.name + ': ' + e.message); }
        job.done++;
      }
    }
    // pasted links (RSS / feed URLs)
    for (const u of (body.urls || [])) {
      if (job.cancel) break;
      try {
        const src = /\.(xml|rss|atom)(\?|$)|\/feed|feeds\//.test(u) ? 'rss' : 'rss';
        const r = await workerCall('/search?source=rss&url=' + encodeURIComponent(u) + '&limit=' + limit);
        for (const it of (r.items || [])) { it.collected_at = Math.floor(Date.now() / 1000); await idb.put('items', it); found++; added++; }
      } catch (e) { job.stats.errors++; job.log('  ✕ ' + u + ': ' + e.message); }
    }
    job.stats.found = found; job.stats.new = added;
  }

  // ── sources (stored in kv) ────────────────────────────────────
  async function listSources() { const row = await idb.get('kv', 'sources'); return (row && row.v) || []; }
  async function saveSources(arr) { await idb.put('kv', { k: 'sources', v: arr }); return arr; }

  // ── jobs (in-memory, mirror the server's job shape) ───────────
  const JOBS = {};
  function newJob(kind, title) { const id = Math.random().toString(36).slice(2, 10); const j = { id, kind, title: title || kind, state: 'running', created: Math.floor(Date.now() / 1000), started: Math.floor(Date.now() / 1000), finished: null, stats: { found: 0, new: 0, updated: 0, linked: 0, downloaded: 0, analyzed: 0, skipped: 0, errors: 0 }, done: 0, total: 1, log_lines: [], cancel: false, log(m) { this.log_lines.push(new Date().toLocaleTimeString() + ' ' + m); } }; JOBS[id] = j; return j; }
  function jobDict(j, full) { return { id: j.id, kind: j.kind, title: j.title, state: j.state, created: j.created, started: j.started, finished: j.finished, stats: j.stats, done: j.done, total: j.total, topic_id: j.topic_id || null, result: j.result || null, log: full ? j.log_lines : j.log_lines.slice(-5) }; }

  // ── the API surface the app calls ─────────────────────────────
  const Local = {
    enabled: false,
    learn: null,                 // set by searchnet-learn.js
    async init() { await settings(); await loadSyn(); this.enabled = true; },

    async request(path, opts = {}) {
      const method = (opts.method || 'GET').toUpperCase();
      const [pathname, qs] = path.replace(/^\/api\//, '').split('?');
      const parts = pathname.split('/');
      const body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : {};
      const route = parts[0], arg = parts[1], sub = parts[2];
      const items = () => idb.all('items');

      if (route === 'status') {
        const all = await items(); const s = await settings();
        return { ok: true, local: true, auth: true, tools: { worker: !!s.worker_url }, counts: { n: all.length, files: 0, speech: all.filter((i) => i.transcript).length }, vectors: 0, semantic: false, data_dir: 'your browser (IndexedDB)', settings: s, topics: (await idb.all('topics')).length, worker_url: s.worker_url };
      }
      if (route === 'search') { await loadSyn(); return runSearch(await items(), qs || ''); }
      if (route === 'synonyms') { if (method === 'PUT') { SYN = body.groups || []; await saveSettings({ synonyms: SYN }); } return { groups: SYN }; }
      if (route === 'settings') { if (method === 'PUT') { SET = await saveSettings(body); } return await settings(); }
      if (route === 'understand' && method === 'POST') { const j = newJob('understand', 'understand (not available in browser)'); j.state = 'done'; j.finished = Math.floor(Date.now() / 1000); return jobDict(j); }

      if (route === 'items' && arg) {
        const it = await idb.get('items', arg);
        if (sub === 'related') return this.learn ? this.learn.related(await items(), arg) : { items: [], terms: [] };
        if (sub === 'play') return { url: it ? (it.media_url || await resolvePlay(it)) : null };
        if (sub === 'topics') return { topics: this.learn ? await this.learn.itemTopics(arg) : [] };
        if (method === 'GET') return it || { error: 'not found' };
        if (method === 'PATCH') { if (!it) return {}; if ('tags' in body) it.tags = normTags(body.tags); if ('notes' in body) it.notes = String(body.notes).slice(0, 20000); if ('starred' in body) it.starred = body.starred ? 1 : 0; await idb.put('items', it); return it; }
        if (method === 'DELETE') { await idb.del('items', arg); if (this.learn) await this.learn.onItemDeleted(arg); return { deleted: true }; }
      }
      if (route === 'bulk' && method === 'POST') {
        const ids = (body.ids || []).map(String); const action = body.action;
        if (action === 'vote' && body.topic_id && this.learn) { for (const id of ids) await this.learn.vote(body.topic_id, id, +body.value); return { ok: true, count: ids.length }; }
        if (['download', 'analyze'].includes(action)) { const j = newJob(action); j.state = 'done'; j.finished = Math.floor(Date.now() / 1000); j.log('Not available in browser mode — run the local PC server for downloads/analysis.'); return jobDict(j); }
        for (const id of ids) {
          const it = await idb.get('items', id); if (!it && action !== 'delete') continue;
          if (action === 'delete') { await idb.del('items', id); if (this.learn) await this.learn.onItemDeleted(id); }
          else if (action === 'tag') { it.tags = [...new Set((it.tags || '').split(' ').filter(Boolean).concat(normTags(body.value).split(' ')))].join(' '); await idb.put('items', it); }
          else if (action === 'untag') { const rm = normTags(body.value).split(' '); it.tags = (it.tags || '').split(' ').filter((t) => t && !rm.includes(t)).join(' '); await idb.put('items', it); }
          else if (action === 'star') { it.starred = 1; await idb.put('items', it); }
          else if (action === 'unstar') { it.starred = 0; await idb.put('items', it); }
        }
        return { ok: true, count: ids.length };
      }

      if (route === 'collect' && method === 'POST') { const j = newJob('collect', body.title || 'collect'); runSafe(j, () => collect(body, j)); return jobDict(j); }

      if (route === 'sources') {
        if (arg === 'presets') return { presets: WORKER_SOURCES };
        if (arg === 'probe' && method === 'POST') return { candidates: probe(body.text) };
        const all = await listSources();
        if (!arg) {
          if (method === 'GET') return { sources: all };
          if (method === 'POST') { const p = WORKER_SOURCES.find((x) => x.preset === body.preset); const s = p ? { source: p.source, name: p.name + (body.param ? ' · ' + body.param : ''), param: p.param, value: body.param || p.param_default || '', searchable: p.searchable, preset: p.preset } : body; s.id = Math.random().toString(36).slice(2, 10); s.enabled = true; s.kind = s.source; s.limit_per = s.limit_per || 30; all.push(s); await saveSources(all); return s; }
        }
        const s = all.find((x) => x.id === arg);
        if (s && method === 'PATCH') { Object.assign(s, body); await saveSources(all); return s; }
        if (s && method === 'DELETE') { await saveSources(all.filter((x) => x.id !== arg)); return { ok: true }; }
        if (s && sub === 'test' && method === 'POST') { const j = newJob('test', 'test ' + s.name); runSafe(j, async () => { const params = new URLSearchParams({ source: s.source, q: body.query || 'cat', limit: 5 }); if (s.value) params.set('instance', s.value); if (s.param === 'url') { params.delete('instance'); params.set('url', s.value || ''); } const r = await workerCall('/search?' + params); j.result = { count: (r.items || []).length, items: (r.items || []).slice(0, 5).map((i) => ({ id: i.id, text: i.text, thumbnail: i.thumbnail, media: i.media, url: i.url, author: i.author })) }; }); return jobDict(j); }
      }

      if (route === 'jobs') {
        if (!arg) return { jobs: Object.values(JOBS).sort((a, b) => b.created - a.created).map((j) => jobDict(j)) };
        if (sub === 'cancel' && method === 'POST') { const j = JOBS[arg]; if (j) j.cancel = true; return j ? jobDict(j) : { error: 'no job' }; }
        const j = JOBS[arg]; return j ? jobDict(j, true) : { error: 'no job' };
      }
      if (route === 'wipe' && method === 'POST') { if (body.confirm !== 'WIPE') return { error: 'confirm' }; await idb.clear('items'); await idb.clear('topics'); await idb.clear('votes'); return { removed: {}, ok: true }; }

      // topics are handled by the learn module when present
      if (route === 'topics' && this.learn) return this.learn.request(method, parts, qs || '', body);

      return { error: 'not available in browser mode: ' + path };
    },
  };

  function runSafe(job, fn) { Promise.resolve().then(fn).then(() => { job.state = job.cancel ? 'cancelled' : 'done'; }).catch((e) => { job.state = 'error'; job.log('ERROR: ' + (e && e.message || e)); }).finally(() => { job.finished = Math.floor(Date.now() / 1000); }); }
  function normTags(t) { if (typeof t === 'string') t = t.split(/[,\s]+/); const out = []; for (let x of (t || [])) { x = String(x).toLowerCase().replace(/^#/, '').replace(/[^\w-]+/g, ''); if (x && !out.includes(x)) out.push(x); } return out.join(' '); }
  async function resolvePlay(it) { try { const s = await settings(); if (!s.worker_url) return null; const r = await workerCall('/resolve?url=' + encodeURIComponent(it.url || '')); return r.url || null; } catch (e) { return null; } }
  function probe(text) {
    text = (text || '').trim(); const out = [];
    if (/\.(xml|rss|atom)(\?|$)|\/feed|feeds\//.test(text)) out.push({ name: text, kind: 'rss', source: 'rss', template: text, value: text, searchable: false, why: 'feed URL' });
    const dom = text.replace(/^https?:\/\//, '').replace(/\/.*/, '');
    if (/mastodon|social|\.art$|fediverse/.test(dom)) out.push({ name: 'Mastodon · ' + dom, source: 'mastodon', param: 'instance', value: dom, searchable: true, why: 'looks like a Mastodon server' });
    if (/lemmy/.test(dom)) out.push({ name: 'Lemmy · ' + dom, source: 'lemmy', param: 'instance', value: dom, searchable: true, why: 'Lemmy instance' });
    return out;
  }

  // expose internals the learn module needs
  Local.idb = idb; Local.settings = settings; Local.runSearch = runSearch; Local.loadSyn = loadSyn;
  Local.getSyn = () => SYN; Local.newJob = newJob; Local.jobDict = jobDict; Local.runSafe = runSafe;
  Local.jobs = JOBS;
  window.SearchNetLocal = Local;
})();
