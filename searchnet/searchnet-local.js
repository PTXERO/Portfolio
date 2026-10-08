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
  const DB_NAME = 'searchnet', DB_VER = 2;
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
        if (!db.objectStoreNames.contains('rel')) db.createObjectStore('rel', { keyPath: 'k' });   // v2: real account→account relations (follows)
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
    { preset: 'html', name: 'Any site (its search page)', source: 'html', param: 'url', searchable: true, note: "The site's search URL with {q} where the word goes, e.g. https://site.com/search?q={q}" },
    // the open web (articles are always kept, the media setting does not apply)
    { preset: 'news', name: 'News (Google News)', source: 'news', param: 'qx', searchable: true, note: 'Global, national and local papers, TV and wires. Put a place in the box for local news.' },
    { preset: 'gdelt', name: 'News archive (GDELT)', source: 'gdelt', param: 'qx', searchable: true, note: 'World news index going back years. Phrases in quotes.' },
    { preset: 'web', name: 'Websites & blogs (Bing)', source: 'web', param: 'qx', searchable: true, note: 'Anything indexed: blogs, forums, company and school sites.' },
    { preset: 'obituaries', name: 'Obituaries', source: 'web', param: 'qx', param_default: 'obituary OR obituaries OR "passed away"', searchable: true },
    { preset: 'schools', name: 'Schools & universities', source: 'web', param: 'qx', param_default: 'site:.edu OR site:.k12.*.us OR school', searchable: true },
    { preset: 'blogs', name: 'Blogs', source: 'web', param: 'qx', param_default: 'blog OR site:substack.com OR site:medium.com OR site:wordpress.com OR site:blogspot.com', searchable: true },
    { preset: 'hn', name: 'Hacker News', source: 'hn', searchable: true },
    { preset: 'fourchan', name: '4chan', source: 'fourchan', param: 'boards', param_default: 'pol,news,b,g,x,tv,v,biz,int,k', searchable: true, note: 'desuarchive full-text search plus the live catalogs of these boards.' },
    { preset: 'wikipedia', name: 'Wikipedia', source: 'wikipedia', searchable: true },
    { preset: 'archive', name: 'Internet Archive', source: 'archive', searchable: true, note: 'Books, newspapers, recordings, old sites.' },
  ];
  // 'https://site/search?q=cats' (or '?q=') → 'https://site/search?q={q}'; also /search/cats → /search/{q}
  const Q_PARAMS = new Set(['q', 's', 'search', 'query', 'term', 'keyword', 'keywords', 'k', 'text', 'search_query', 'wd', 'p']);
  function searchUrlToTemplate(url) {
    try {
      const u = new URL(url); let hit = false;
      for (const k of [...u.searchParams.keys()]) if (Q_PARAMS.has(k.toLowerCase())) { u.searchParams.set(k, '__Q__'); hit = true; break; }
      if (hit) return u.toString().replace('__Q__', '{q}');
      const m = u.pathname.match(/^(.*\/(?:search|s|tag|tags|find|results|hashtag)\/)([^/]+)\/?$/);
      if (m) { u.pathname = m[1] + '{q}'; return u.toString().replace('%7Bq%7D', '{q}'); }
    } catch (e) { /* not a URL */ }
    return null;
  }
  // Where fetching happens. In order: a SearchNet-only Worker you pasted (advanced), else the hub chosen in
  // YOUR DATA (PTXERO's shared hub by default, or your own). Requests to a hub are signed with your PTXERO ID,
  // so its fair-use limits are per person; a 429 waits politely (PX.fetch) instead of failing outright.
  function hub(s) {
    if (s && s.worker_url) return { base: s.worker_url.replace(/\/$/, ''), key: s.worker_key || '', signed: false, kind: 'worker' };
    if (window.PX) { const h = window.PX.host(); return { base: h.hub, key: '', signed: true, kind: h.mode === 'own' ? 'own' : 'shared' }; }
    return null;
  }
  async function hubInfo() { return hub(await settings()); }
  async function workerCall(path) {
    const s = await settings(); const h = hub(s);
    if (!h) throw new Error('No hub: paste a Worker URL in SOURCES, or reload to use the shared hub');
    const url = h.base + path + (h.key ? (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(h.key) : '');
    const r = h.signed ? await window.PX.fetch(url) : await fetch(url, { headers: h.key ? { 'X-SN-Key': h.key } : {} });
    const j = await r.json().catch(() => ({}));
    if (h.signed && r.status === 404 && /not found/i.test(j.error || ''))
      throw new Error((h.kind === 'own' ? 'Your hub' : 'The shared hub') + ' at ' + h.base + ' is not on hub 2.0 yet. ' + (h.kind === 'own' ? 'Paste hub/hub-worker.js into that Worker and Deploy (see the hub guide)' : 'The owner has to redeploy it. Until then, SOURCES → Advanced takes your own Worker URL'));
    if (r.status === 404 && (j.error === 'not found' || !j.error) && !/^\/(search|health)/.test(path))
      throw new Error('Your Worker is older than this app. Paste the new worker/searchnet-worker.js into Cloudflare (SOURCES → your Worker → how to update)');
    if (r.status === 429 && j.error === 'quota') throw new Error('Fair-use limit on the ' + (h.kind === 'own' ? 'hub' : 'shared hub') + ': ' + j.used + '/' + j.limit + ' ' + j.scope + ' today. ' + (j.hint || ''));
    if (!r.ok) throw new Error(j.error || ('Hub HTTP ' + r.status));
    return j;
  }
  // ── backup of what you taught it (topics, votes, follows, sources, identities, settings — not the media itself) ──
  const BACKUP_STORES = ['topics', 'votes', 'rel', 'kv'];   // kv holds sources, identities, settings, web weights
  async function backupData() {
    const out = { _type: 'searchnet-backup', version: 1, made: Math.floor(Date.now() / 1000) };
    for (const st of BACKUP_STORES) out[st] = await idb.all(st);
    // a topic marked "this device only" never leaves this browser: not it, not its ratings
    const keepOut = new Set(out.topics.filter((t) => t && t.settings && t.settings.visibility === 'device').map((t) => t.id));
    out.topics = out.topics.filter((t) => !keepOut.has(t.id)); out.votes = out.votes.filter((v) => !keepOut.has(v.topic_id) && v.from !== 'hub'); out.left_out = keepOut.size;   // pooled ratings are the hub's, not yours to back up
    out.kv = out.kv.map((r) => (r && r.k === 'settings' && r.v) ? { k: r.k, v: Object.assign({}, r.v, { worker_key: '' }) } : r);  // never back up a Worker secret
    const dead = await idb.get('kv', 'deleted_topics'); out.deleted = (dead && dead.v) || {};      // tombstones, so a deletion wins over a stale copy elsewhere
    return out;
  }
  // the same id on several devices: fold what the hub holds into this library and say what moved each way.
  // Topics by id, newest `updated` wins, a deletion beats an older copy; ratings by key, newest wins. Nothing else is merged.
  async function mergeData(remote) {
    if (!remote || remote._type !== 'searchnet-backup') return { pulled: 0, pushed: 0, changed: false };
    const dead = Object.assign({}, ((await idb.get('kv', 'deleted_topics')) || {}).v || {}); const rdead = remote.deleted || {};
    for (const id in rdead) if (!dead[id] || rdead[id] > dead[id]) dead[id] = rdead[id];
    const local = await idb.all('topics'); const byId = {}; local.forEach((t) => byId[t.id] = t);
    let pulled = 0, pushed = 0;
    for (const rt of remote.topics || []) { if (!rt || !rt.id || (rt.settings || {}).visibility === 'device') continue;
      if (dead[rt.id] && dead[rt.id] >= (rt.updated || rt.created || 0)) continue;
      const lt = byId[rt.id]; if (!lt) { await idb.put('topics', rt); byId[rt.id] = rt; pulled++; }
      else if ((rt.updated || 0) > (lt.updated || 0)) { await idb.put('topics', rt); byId[rt.id] = rt; pulled++; }
      else if ((lt.updated || 0) > (rt.updated || 0)) pushed++; }
    for (const lt of local) { if (dead[lt.id] && dead[lt.id] >= (lt.updated || lt.created || 0)) { await idb.del('topics', lt.id); for (const v of await idb.all('votes')) if (v.topic_id === lt.id) await idb.del('votes', v.k); pulled++; continue; }
      if (!(remote.topics || []).some((rt) => rt && rt.id === lt.id) && (lt.settings || {}).visibility !== 'device') pushed++; }
    const lv = {}; (await idb.all('votes')).forEach((v) => lv[v.k] = v);
    for (const rv of remote.votes || []) { if (!rv || !rv.k || !byId[rv.topic_id]) continue; const cur = lv[rv.k]; const rt = rv.labeled_at || rv.ts || 0, ct = cur ? (cur.labeled_at || cur.ts || 0) : -1;
      if (!cur || rt > ct) { await idb.put('votes', rv); pulled++; } else if (ct > rt) pushed++; }
    await idb.put('kv', { k: 'deleted_topics', v: dead });
    return { pulled, pushed, changed: pulled > 0 || pushed > 0 };
  }
  async function restoreData(d) {
    if (!d || d._type !== 'searchnet-backup') throw new Error('not a SearchNet backup');
    let n = 0;
    for (const st of BACKUP_STORES) for (const row of (d[st] || [])) { if (row && (row.id || row.k)) { await idb.put(st, row); n++; } }
    SET = null;
    return { restored: n };
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
          if (s.param === 'qx' && s.value) params.set('qx', s.value);
          if (s.param === 'url' && s.value) params.set('url', s.value);
          if (s.param === 'boards' && s.value) params.set('boards', s.value);
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
        } catch (e) { job.stats.errors++; job.log('  ✕ ' + s.name + ': ' + e.message); if (await markFailed(s.id, e.message)) job.log('    ' + s.name + ' switched off until you turn it back on (SOURCES)'); }
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
  const DEFAULT_PRESETS = ['mastodon', 'lemmy', 'reddit', 'bluesky', 'youtube', 'news', 'gdelt', 'web', 'obituaries', 'schools', 'blogs', 'hn', 'archive', 'fourchan', 'wikipedia'];
  function fromPreset(p, param) { return { id: Math.random().toString(36).slice(2, 10), source: p.source, kind: p.source, name: p.name + (param && p.param !== 'qx' ? ' · ' + param : ''), param: p.param, value: param || p.param_default || '', searchable: p.searchable, preset: p.preset, enabled: true, limit_per: 30 }; }
  async function listSources() {
    const row = await idb.get('kv', 'sources'); let all = (row && row.v) || [];
    // every built-in source is on from the start; ones added later join once (a source you removed stays removed)
    const seenRow = await idb.get('kv', 'sources_seeded'); const seeded = new Set((seenRow && seenRow.v) || []);
    const add = DEFAULT_PRESETS.filter((k) => !seeded.has(k) && !all.some((s) => s.preset === k));
    if (add.length) { add.forEach((k) => { const p = WORKER_SOURCES.find((x) => x.preset === k); if (p) all.push(fromPreset(p, p.param_default || '')); }); await saveSources(all); }
    if (add.length || !seenRow) await idb.put('kv', { k: 'sources_seeded', v: [...new Set([...seeded, ...DEFAULT_PRESETS])] });
    const seen = new Set(); const dedup = all.filter((s) => { const k = (s.preset || s.source) + '|' + (s.value || ''); if (s.preset && seen.has(k)) return false; seen.add(k); return true; });
    if (dedup.length !== all.length) { all = dedup; await saveSources(all); }     // a double seeding once made two 4chans
    return all;
  }
  // a source that errors (not a quota wait, not the hub being down) turns itself off; the switch in SOURCES turns it back on
  // the hub, not the source, is the problem: an older Worker, a limit, a network blip. Never a reason to switch a source off.
  const HUB_PROBLEM = /quota|limit|busy|Failed to fetch|NetworkError|hub 2\.0|older than this app|unknown source|not found|HTTP (?:401|404|429|500|502|503|504)|timed out|Hub HTTP/i;
  async function markFailed(id, msg) {
    if (!id || HUB_PROBLEM.test(msg || '')) return false;
    const all = await listSources(); const s = all.find((x) => x.id === id); if (!s || !s.enabled) return false;
    s.fails = (s.fails || 0) + 1; s.last_error = String(msg || '').slice(0, 200);
    if (s.fails < 3) { await saveSources(all); return false; }                      // three runs in a row, then off
    s.enabled = false; s.auto_off = Math.floor(Date.now() / 1000); s.fails = 0; await saveSources(all); return true;
  }
  async function markWorked(id) { const all = await listSources(); const s = all.find((x) => x.id === id); if (s && (s.fails || s.last_error)) { s.fails = 0; s.last_error = ''; await saveSources(all); } }
  async function saveSources(arr) { await idb.put('kv', { k: 'sources', v: arr }); return arr; }

  // ── jobs (in-memory, mirror the server's job shape) ───────────
  const JOBS = {};
  function newJob(kind, title) { const id = Math.random().toString(36).slice(2, 10); const j = { id, kind, title: title || kind, state: 'running', created: Math.floor(Date.now() / 1000), started: Math.floor(Date.now() / 1000), finished: null, stats: { found: 0, new: 0, updated: 0, linked: 0, downloaded: 0, analyzed: 0, skipped: 0, errors: 0 }, done: 0, total: 1, log_lines: [], cancel: false, log(m) { this.log_lines.push(new Date().toLocaleTimeString() + ' ' + m); } }; JOBS[id] = j; return j; }
  function jobDict(j, full) { return { id: j.id, kind: j.kind, title: j.title, state: j.state, created: j.created, started: j.started, finished: j.finished, stats: j.stats, done: j.done, total: j.total, topic_id: j.topic_id || null, result: j.result || null, log: full ? j.log_lines : j.log_lines.slice(-5) }; }

  // ── the API surface the app calls ─────────────────────────────
  const Local = {
    enabled: false,
    learn: null,                 // set by searchnet-learn.js
    people: null,                // set by searchnet-graph.js
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
        const h = hub(s);
        return { ok: true, local: true, auth: true, tools: { worker: !!h }, counts: { n: all.length, files: 0, speech: all.filter((i) => i.transcript).length }, vectors: 0, semantic: false, data_dir: 'your browser (IndexedDB)', settings: s, topics: (await idb.all('topics')).length, worker_url: h ? h.base : '', hub: h };
      }
      if (route === 'search') {
        await loadSyn();
        const P = Object.fromEntries(new URLSearchParams(qs || ''));
        let pool = await items();
        // topic filter: only items linked to the topic (what the server's search does)
        if (P.topic) {
          const minS = P.topic_min !== undefined && P.topic_min !== '' ? +P.topic_min : 0.5;
          const sc = {};
          (await idb.all('votes')).filter((v) => v.topic_id === P.topic).forEach((v) => {
            const keep = P.topic_all === '1' || v.label > 0 || (v.label === 0 && (v.score || 0) >= minS);
            if (keep) sc[v.item_id] = v;
          });
          pool = pool.filter((it) => sc[it.id]).map((it) => Object.assign({}, it, { t_score: sc[it.id].score, t_label: sc[it.id].label }));
        }
        const sortTopic = P.sort === 'topic';
        const p2 = new URLSearchParams(qs || ''); if (sortTopic) p2.delete('sort');
        const res = runSearch(pool, p2.toString());
        if (sortTopic) {
          // re-rank the whole match set by topic score, then re-page
          const all = runSearch(pool, (() => { const q = new URLSearchParams(p2); q.set('offset', '0'); q.set('limit', '100000'); return q.toString(); })()).items
            .sort((a, b) => (b.t_score || 0) - (a.t_score || 0) || (b._s - a._s));
          const off = +P.offset || 0, lim = +P.limit || 40;
          res.items = all.slice(off, off + lim); res.total = all.length;
        }
        return res;
      }
      if (route === 'synonyms') { if (method === 'PUT') { SYN = body.groups || []; await saveSettings({ synonyms: SYN }); } return { groups: SYN }; }
      if (route === 'settings') { if (method === 'PUT') { SET = await saveSettings(body); } return await settings(); }
      if (route === 'backup') { if (method === 'POST') return await restoreData(body); return await backupData(); }
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
        if (arg === 'discover' && method === 'POST') return await workerCall('/discover?url=' + encodeURIComponent(body.url || ''));
        if (arg === 'article' && method === 'POST') return await workerCall('/article?url=' + encodeURIComponent(body.url || ''));
        if (arg === 'author' && method === 'POST') return await workerCall('/author?url=' + encodeURIComponent(body.url || ''));
        if (arg === 'probe' && method === 'POST') return { candidates: probe(body.text) };
        const all = await listSources();
        if (!arg) {
          if (method === 'GET') return { sources: all };
          if (method === 'POST') { const p = WORKER_SOURCES.find((x) => x.preset === body.preset); const s = p ? { source: p.source, name: body.name || (p.name + (body.param ? ' · ' + body.param : '')), param: p.param, value: body.param || p.param_default || '', searchable: p.searchable, preset: p.preset } : body; s.id = Math.random().toString(36).slice(2, 10); s.enabled = true; s.kind = s.source; s.limit_per = s.limit_per || 30; all.push(s); await saveSources(all); return s; }
        }
        const s = all.find((x) => x.id === arg);
        if (arg === 'enable-all' && method === 'POST') { let n = 0; all.forEach((x) => { if (!x.enabled) { x.enabled = true; delete x.auto_off; x.last_error = ''; x.fails = 0; n++; } }); await saveSources(all); return { ok: true, enabled: n }; }
        if (s && method === 'PATCH') { Object.assign(s, body); if (body.enabled) { delete s.auto_off; s.last_error = ''; } await saveSources(all); return s; }
        if (s && method === 'DELETE') { await saveSources(all.filter((x) => x.id !== arg)); return { ok: true }; }
        if (s && sub === 'test' && method === 'POST') { const j = newJob('test', 'test ' + s.name); runSafe(j, async () => { const params = new URLSearchParams({ source: s.source, q: body.query || 'cat', limit: 5 }); if (s.value) params.set('instance', s.value); if (s.param === 'url') { params.delete('instance'); params.set('url', s.value || ''); } const r = await workerCall('/search?' + params); j.result = { count: (r.items || []).length, items: (r.items || []).slice(0, 5).map((i) => ({ id: i.id, text: i.text, thumbnail: i.thumbnail, media: i.media, url: i.url, author: i.author })) }; }); return jobDict(j); }
      }

      if (route === 'jobs') {
        if (!arg) return { jobs: Object.values(JOBS).sort((a, b) => b.created - a.created).map((j) => jobDict(j)) };
        if (sub === 'cancel' && method === 'POST') { const j = JOBS[arg]; if (j) j.cancel = true; return j ? jobDict(j) : { error: 'no job' }; }
        const j = JOBS[arg]; return j ? jobDict(j, true) : { error: 'no job' };
      }
      if (route === 'wipe' && method === 'POST') { if (body.confirm !== 'WIPE') return { error: 'confirm' }; await idb.clear('items'); await idb.clear('topics'); await idb.clear('votes'); await idb.clear('rel'); return { removed: {}, ok: true }; }

      // topics are handled by the learn module when present
      if (route === 'topics' && this.learn) return this.learn.request(method, parts, qs || '', body);
      // account profiles + connection web (searchnet-graph.js)
      if ((route === 'people' || route === 'graph' || route === 'identities' || route === 'writers') && this.people) return this.people.request(method, parts, qs || '', body);

      return { error: 'not available in browser mode: ' + path };
    },
  };

  function runSafe(job, fn) { Promise.resolve().then(fn).then(() => { job.state = job.cancel ? 'cancelled' : 'done'; }).catch((e) => { job.state = 'error'; job.log('ERROR: ' + (e && e.message || e)); }).finally(() => { job.finished = Math.floor(Date.now() / 1000); }); }
  function normTags(t) { if (typeof t === 'string') t = t.split(/[,\s]+/); const out = []; for (let x of (t || [])) { x = String(x).toLowerCase().replace(/^#/, '').replace(/[^\w-]+/g, ''); if (x && !out.includes(x)) out.push(x); } return out.join(' '); }
  async function resolvePlay(it) { try { const s = await settings(); if (!hub(s)) return null; const r = await workerCall('/resolve?url=' + encodeURIComponent(it.url || '')); return r.url || null; } catch (e) { return null; } }
  function probe(text) {
    text = (text || '').trim(); const out = [];
    if (/\.(xml|rss|atom)(\?|$)|\/feed|feeds\//.test(text)) out.push({ name: text, kind: 'rss', source: 'rss', template: text, value: text, searchable: false, why: 'feed URL' });
    const dom = text.replace(/^https?:\/\//, '').replace(/\/.*/, '');
    if (/^https?:\/\//.test(text)) {                       // a search URL from any site: the word you typed becomes {q}
      const tpl = text.includes('{q}') ? text : searchUrlToTemplate(text);
      if (tpl) out.push({ name: dom, source: 'html', param: 'url', value: tpl, searchable: true, why: "your search URL. The word you typed becomes {q}" });
    }
    if (/mastodon|social|\.art$|fediverse/.test(dom)) out.push({ name: 'Mastodon · ' + dom, source: 'mastodon', param: 'instance', value: dom, searchable: true, why: 'looks like a Mastodon server' });
    if (/lemmy/.test(dom)) out.push({ name: 'Lemmy · ' + dom, source: 'lemmy', param: 'instance', value: dom, searchable: true, why: 'Lemmy instance' });
    return out;
  }

  // expose internals the learn module needs
  Local.idb = idb; Local.settings = settings; Local.runSearch = runSearch; Local.loadSyn = loadSyn;
  Local.getSyn = () => SYN; Local.newJob = newJob; Local.jobDict = jobDict; Local.runSafe = runSafe;
  Local.jobs = JOBS; Local.workerCall = workerCall; Local.markFailed = markFailed; Local.markWorked = markWorked; Local.hub = hubInfo; Local.backup = backupData; Local.restore = restoreData; Local.merge = mergeData;
  window.SearchNetLocal = Local;
})();
