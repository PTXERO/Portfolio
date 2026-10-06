/* ─────────────────────────────────────────────────────────────────
 *  SearchNet learning — topics in the browser (no server).
 *  A compact port of the server's relevance engine: per-topic profile
 *  (liked − disliked centroid), query-coverage prior, soft & anti
 *  keywords, 👎 reasons, query expansion, and review/best/brain feeds.
 *  Attaches to window.SearchNetLocal as .learn.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  const L = window.SearchNetLocal;
  if (!L) return;
  const idb = L.idb;
  const now = () => Math.floor(Date.now() / 1000);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const STOP = new Set('a an and are as at be but by for from has have he her his i in into is it its just me my no not of on or our so that the their them then there these they this to too up us was we were what when which who will with you your rt via amp http https www com'.split(' '));
  const stem = (w) => w.replace(/(ings?|edly|ed|es|s|ly)$/, '') || w;
  const tokens = (t) => (String(t || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[\p{L}\p{N}]+/gu) || []);
  const tag = (s) => (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '');

  // ── features & vectors ────────────────────────────────────────
  function feats(it) {
    const f = {}; const add = (k, v) => f[k] = (f[k] || 0) + v;
    const toks = tokens(it.text).map(stem);
    toks.forEach((s) => add('w:' + s, 1));
    for (let i = 0; i < toks.length - 1; i++) add('b:' + toks[i] + '_' + toks[i + 1], 0.7);
    (it.hashtags || '').toLowerCase().split(/\s+/).filter(Boolean).forEach((h) => { add('#:' + h, 1.5); add('w:' + stem(h), 0.5); });
    (it.tags || '').split(/\s+/).filter(Boolean).forEach((t) => add('#:' + t, 0.5));
    if (it.author) add('@:' + String(it.author).toLowerCase(), 1.2);
    if (it.platform) add('s:' + it.platform, 0.5);
    tokens(it.transcript).map(stem).forEach((s) => add('w:' + s, 0.4));
    // L2 normalize with sublinear counts
    const vec = {}; let n = 0;
    for (const k in f) { const v = f[k] >= 1 ? 1 + Math.log(f[k]) : f[k]; vec[k] = v; n += v * v; }
    n = Math.sqrt(n) || 1; for (const k in vec) vec[k] /= n; return vec;
  }
  function centroid(vecs) { const c = {}; vecs.forEach((v) => { for (const k in v) c[k] = (c[k] || 0) + v[k]; }); let n = 0; for (const k in c) { c[k] /= (vecs.length || 1); n += c[k] * c[k]; } n = Math.sqrt(n) || 1; for (const k in c) c[k] /= n; return c; }
  function cos(a, b) { let s = 0; const [x, y] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a]; for (const k in x) if (y[k]) s += x[k] * y[k]; return s; }
  const sig = (z) => z < -30 ? 0 : z > 30 ? 1 : 1 / (1 + Math.exp(-z));
  const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  function itemStems(it) { const s = new Set(); [it.text, it.hashtags, it.tags, it.transcript, it.ocr].forEach((x) => tokens(x).forEach((w) => s.add(stem(w)))); (it.hashtags || '').toLowerCase().split(/\s+/).forEach((h) => h && s.add(stem(h))); if (it.author) s.add('@' + String(it.author).toLowerCase()); return s; }

  // ── topic store ───────────────────────────────────────────────
  const DEF = { breadth: 3, media: 'video', per_query: 20, soft: [], _attr_soft: [], anti: [], prefs: {}, reasons_recent: [], creators: {} };
  async function getTopic(id) { return idb.get('topics', id); }
  async function allTopics() { return idb.all('topics'); }
  async function saveTopic(t) { await idb.put('topics', t); return t; }
  const voteKey = (tid, iid) => tid + '|' + iid;
  async function topicItems(tid) { return (await idb.all('votes')).filter((v) => v.topic_id === tid); }

  function querySet(t) {
    const qs = new Set((t.seeds || []).map((s) => s.toLowerCase()));
    (t.queries || []).filter((q) => q.enabled).forEach((q) => qs.add(q.query.toLowerCase()));
    ((t.settings.soft || []).concat(t.settings._attr_soft || [])).forEach((s) => qs.add(s.toLowerCase()));
    return [...qs].map((q) => ({ q, stems: new Set(tokens(q.replace('#', ' ')).map(stem)), author: q.startsWith('@') ? q.slice(1) : null }));
  }
  function priorScore(it, qterms) {
    const have = itemStems(it); let miss = 1; const best = [];
    for (const t of qterms) {
      let cov;
      if (t.author) cov = have.has('@' + t.author) ? 1 : 0;
      else { if (!t.stems.size) continue; let hit = 0; t.stems.forEach((s) => { if (have.has(s)) hit += 1; else if (s.length >= 4 && [...have].some((h) => h.length > 4 && h.startsWith(s))) hit += 0.8; }); cov = hit / t.stems.size; }
      if (cov > 0) { miss *= 1 - 0.9 * Math.min(1, Math.pow(cov, 1.5)); best.push([cov, t.q]); }
    }
    best.sort((a, b) => b[0] - a[0]);
    return { prior: 1 - miss, matched: best.slice(0, 3).map((x) => x[1]) };
  }

  async function scorer(t) {
    const votes = await topicItems(t.id);
    const labeled = votes.filter((v) => v.label);
    const itemsById = {}; (await idb.all('items')).forEach((i) => itemsById[i.id] = i);
    const pos = [], neg = [];
    labeled.forEach((v) => { const it = itemsById[v.item_id]; if (!it) return; (v.label > 0 ? pos : neg).push(feats(it)); });
    const pc = pos.length ? centroid(pos) : null, nc = neg.length ? centroid(neg) : null;
    const qterms = querySet(t);
    const anti = new Set((t.settings.anti || []).map(stem));
    const prefs = t.settings.prefs || {};
    const seedStems = new Set(); (t.seeds || []).concat(t.settings.soft || [], t.settings._attr_soft || []).forEach((s) => tokens(s).forEach((w) => seedStems.add(stem(w))));
    const nPos = pos.length, nNeg = neg.length, n = nPos + nNeg;
    return {
      nPos, nNeg, pc, nc, itemsById, qterms,
      score(it) {
        const { prior, matched } = priorScore(it, qterms);
        const why = { matched, prior: +prior.toFixed(3) };
        let final = prior;
        if (n > 0 && (pc || nc)) {
          const x = feats(it);
          const r = (pc ? cos(x, pc) : 0) - 0.7 * (nc ? cos(x, nc) : 0);
          const learned = sig(5 * r - 0.5);
          const alpha = Math.min(0.85, n / (n + 4));
          final = (1 - alpha) * prior + alpha * learned;
          why.model = +learned.toFixed(3);
          // why-not: item words with negative profile weight
          if (nc) { const lower = []; for (const k of Object.keys(x)) { if ((k[0] === 'w' || k[0] === '#') && nc[k] && (!pc || !pc[k])) lower.push(k); } why._lowerRaw = lower; }
        }
        const have = itemStems(it); const flags = [];
        if (anti.size) { const hit = [...anti].filter((a) => have.has(a)); if (hit.length) { final *= Math.max(0.1, 1 - 0.6 * Math.min(3, hit.length)); flags.push(...hit.slice(0, 3)); } }
        const d = it.duration || 0;
        if (prefs.avoid_short && d > 0 && d < 30) { final *= 0.4; flags.push('short'); }
        if (prefs.avoid_long && d > 180) { final *= 0.5; flags.push('long'); }
        const lower = (why._lowerRaw || []).map(readable).concat(flags).filter((w) => { const b = String(w).replace(/^[#@]/, ''); return b && !seedStems.has(stem(b)); });
        delete why._lowerRaw;
        if (lower.length) why.lower = [...new Set(lower)].slice(0, 4);
        return { score: final, why };
      },
    };
  }
  function readable(k) { const [kind, val] = [k[0], k.slice(2)]; return kind === '#' ? '#' + val : kind === '@' ? '@' + val : val; }

  async function rescore(tid) {
    const t = await getTopic(tid); if (!t) return;
    const sc = await scorer(t);
    const votes = await topicItems(tid);
    for (const v of votes) { const it = sc.itemsById[v.item_id]; if (!it) continue; const r = sc.score(it); v.score = +r.score.toFixed(5); v.why = r.why; await idb.put('votes', v); }
  }

  // ── expansion (morph + synonyms + co-occurrence + learned + soft) ──
  function morph(seed) { const s = seed.trim().toLowerCase(); if (!s || s[0] === '@' || /["():]/.test(seed)) return []; const words = s.replace('#', '').split(/\s+/); const out = []; if (words.length > 1) out.push(words.join('')); out.push('#' + tag(s)); const last = words[words.length - 1]; if (last.length > 3 && !/ing$|ism$|ness$/.test(last)) { let alt; if (last.endsWith('ies')) alt = last.slice(0, -3) + 'y'; else if (last.endsWith('s') && !last.endsWith('ss')) alt = last.slice(0, -1); else alt = last + 's'; out.push(words.slice(0, -1).concat(alt).join(' ')); } return [...new Set(out)].filter((o) => o && o !== s); }
  function synVariants(seed) { const syn = {}; (L.getSyn() || []).forEach((g) => g.forEach((w) => { syn[w] = (syn[w] || []).concat(g.filter((x) => x !== w)); })); const s = seed.toLowerCase().replace('#', ''); return [...new Set((syn[s] || []))]; }
  async function expand(tid) {
    const t = await getTopic(tid); if (!t) return;
    t.queries = t.queries || [];
    const existing = new Set(t.queries.map((q) => q.query.toLowerCase()).concat((t.seeds || []).map((s) => s.toLowerCase())));
    const add = (q, origin, enabled) => { const ql = q.trim().toLowerCase(); if (!ql || existing.has(ql) || ql.length > 120) return; existing.add(ql); t.queries.push({ query: q.trim(), origin, enabled: !!enabled, runs: 0, found: 0, pos: 0, neg: 0, locked: false }); };
    const breadth = t.settings.breadth || 3;
    for (const s of (t.seeds || [])) {
      morph(s).forEach((m) => add(m, 'morph', true));
      synVariants(s).forEach((v, i) => add(v, 'synonym', i < breadth));
    }
    // soft keywords as their own + combined with main
    const soft = (t.settings.soft || []).concat(t.settings._attr_soft || []);
    const main = (t.seeds || [])[0] || '';
    soft.forEach((sk, i) => { add(sk, 'soft', i < 2); if (main && !main.toLowerCase().includes(sk.toLowerCase())) add(main + ' ' + sk, 'soft', true); });
    // co-occurrence from liked items
    const votes = await topicItems(tid); const liked = votes.filter((v) => v.label > 0);
    if (liked.length >= 3) {
      const itemsById = {}; (await idb.all('items')).forEach((i) => itemsById[i.id] = i);
      const tags = {}, words = {};
      liked.forEach((v) => { const it = itemsById[v.item_id]; if (!it) return; new Set((it.hashtags || '').toLowerCase().split(/\s+/).filter(Boolean)).forEach((h) => tags[h] = (tags[h] || 0) + 1); new Set(tokens(it.text).filter((w) => w.length > 3 && !STOP.has(w))).forEach((w) => words[w] = (words[w] || 0) + 1); });
      Object.entries(tags).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, breadth).forEach(([h]) => add('#' + h, 'cooccur', true));
      Object.entries(words).filter(([, c]) => c >= 2 && c / liked.length >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, breadth).forEach(([w]) => add(w, 'cooccur', breadth >= 3));
    }
    await saveTopic(t);
  }

  // ── running a topic (collect through the Worker, score, link) ──
  async function runTopic(tid, job) {
    const t = await getTopic(tid); if (!t) throw new Error('topic gone');
    const person = (t.settings || {}).person;
    job.topic_id = tid; job.log('◎ ' + t.name + (person ? ': person dossier — accounts\' own feeds' : ': expanding searches'));
    if (!person) await expand(tid);
    const t2 = await getTopic(tid);
    const queries = (t2.queries || []).filter((q) => q.enabled).map((q) => q.query);
    const seeds = t2.seeds || [];
    let runQs = [...new Set(seeds.concat(queries))].slice(0, 3 + 2 * (t2.settings.breadth || 3));
    let srcs = (await L.request('/api/sources')).sources.filter((s) => s.enabled && s.searchable);
    if (person && person.mode === 'account') {        // one @account: its own feed + 'from:' searches only (Bluesky supports them)
      runQs = runQs.filter((q) => /^from:/i.test(q)); srcs = srcs.filter((s) => s.source === 'bluesky');
    } else if (person) {                               // a name: quoted-name searches only, never grown keywords
      runQs = runQs.filter((q) => q.startsWith('"') || /^from:/i.test(q) || q.toLowerCase() === [person.first, person.last].filter(Boolean).join(' ').toLowerCase());
    }
    if (t2.sources && t2.sources.length) srcs = srcs.filter((s) => t2.sources.includes(s.id));
    job.total = Math.max(1, runQs.length * srcs.length + 2);
    job.log('  ' + runQs.length + ' searches × ' + srcs.length + ' sources');
    const seen = new Set();
    // collect directly (synchronously), then link everything matching
    await collectForTopic(t2, runQs, srcs, job, seen);
    // creators (person dossiers): refresh each account's own feed through the Worker and keep it linked
    for (const c of Object.values(t2.settings.creators || {})) {
      if (job.cancel) break;
      if (!WORKER_ACCOUNT.has(c.platform)) continue;
      try {
        const mj = await L.people.request('POST', ['people', c.handle + '|' + c.platform, 'more'], '', { limit: 30, media: t2.settings.media === 'video' ? 'video' : 'all' });
        for (let i = 0; i < 90 && mj.id; i++) { const r = L.jobs[mj.id]; if (!r || !['running', 'queued'].includes(r.state)) break; await new Promise((x) => setTimeout(x, 300)); }
        const own = (await idb.all('items')).filter((it) => String(it.author || '').toLowerCase() === c.handle.toLowerCase() && it.platform === c.platform);
        for (const it of own) await link(tid, it.id, '@' + c.handle, 'creator');
        job.log('  @' + c.handle + ': ' + own.length + ' of their posts');
      } catch (e) { job.log('  @' + c.handle + ': ' + e.message); }
    }
    // link items from the library that match, score all
    await linkAndScore(tid, job);
    t2.last_run = now(); await saveTopic(t2);
    job.result = { topic_id: tid, new: seen.size, queries: runQs };
  }
  async function collectForTopic(t, runQs, srcs, job, seen) {
    for (const q of runQs) {
      for (const s of srcs) {
        if (job.cancel) return;
        try {
          const params = new URLSearchParams({ source: s.source, q, limit: t.settings.per_query || 20, media: t.settings.media || 'video' });
          if (s.value && s.param === 'instance') params.set('instance', s.value);
          const r = await workerSearch(params);
          const q2 = (t.queries || []).find((x) => x.query === q);
          let found = 0;
          for (const it of (r.items || [])) {
            if (!it.id) continue;
            it.collected_at = now();
            if (!(await idb.get('items', it.id))) { await idb.put('items', it); }
            await link(t.id, it.id, q, s.id); seen.add(it.id); found++;
          }
          if (q2) { q2.runs++; q2.found += found; }
          job.stats.found += found; job.log('  ' + found + ' · ' + q + ' @ ' + s.name);
        } catch (e) { job.stats.errors++; job.log('  ✕ ' + s.name + ': ' + e.message); }
        job.done++;
      }
    }
    await saveTopic(t);
  }
  async function workerSearch(params) {
    const s = await L.settings(); if (!s.worker_url) throw new Error('set your Worker URL in SOURCES');
    const base = s.worker_url.replace(/\/$/, '');
    const r = await fetch(base + '/search?' + params + (s.worker_key ? '&key=' + encodeURIComponent(s.worker_key) : ''), { headers: s.worker_key ? { 'X-SN-Key': s.worker_key } : {} });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j;
  }
  async function notThem(tid) { const t = await getTopic(tid); const p = (t && t.settings && t.settings.person) || {}; return new Set((p.not_them || []).map((x) => String(x).toLowerCase())); }
  async function link(tid, iid, query, sid) {
    const bad = await notThem(tid);
    if (bad.size) { const it = await idb.get('items', iid); if (it && bad.has(String(it.author || '').toLowerCase() + '|' + (it.platform || ''))) return; }   // a namesake: never into this dossier
    const k = voteKey(tid, iid); let v = await idb.get('votes', k);
    if (!v) { v = { k, topic_id: tid, item_id: iid, label: 0, score: 0, why: {}, added: now(), found_by: [] }; }
    if (query && !(v.found_by || []).some((f) => f.query === query && f.source === sid)) (v.found_by = v.found_by || []).push({ query, source: sid });
    await idb.put('votes', v);
  }
  async function linkAndScore(tid, job) {
    const t = await getTopic(tid);
    // sweep library for matches to each query
    const qs = (t.queries || []).filter((q) => q.enabled).map((q) => q.query).concat(t.seeds || []);
    const allItems = await idb.all('items');
    for (const q of [...new Set(qs)]) {
      const res = L.runSearch(allItems, new URLSearchParams({ q, limit: 150, fuzzy: '0', media: t.settings.media === 'video' ? 'video' : 'video,image' }).toString());
      for (const it of res.items) await link(tid, it.id, q, 'library');
    }
    job.done++;
    await rescore(tid); job.stats.linked = (await topicItems(tid)).length; job.done++;
  }

  // ── feeds ─────────────────────────────────────────────────────
  async function feed(tid, qs) {
    const P = Object.fromEntries(new URLSearchParams(qs));
    const view = P.view || 'feed'; const limit = +P.limit || 30; const offset = +P.offset || 0;
    const label = { review: 0, liked: 1, nope: -1 }[view];
    let votes = await topicItems(tid);
    if (label !== undefined) votes = votes.filter((v) => v.label === label);
    if (P.skip) { const sk = new Set(P.skip.split(',')); votes = votes.filter((v) => !sk.has(v.item_id)); }
    const total = votes.length;
    const itemsById = {}; (await idb.all('items')).forEach((i) => itemsById[i.id] = i);
    const srcNames = {}; (await L.request('/api/sources')).sources.forEach((s) => srcNames[s.id] = s.name);
    let rows;
    if (view === 'review') {
      const best = votes.slice().sort((a, b) => b.score - a.score);
      const unsure = votes.slice().sort((a, b) => Math.abs(a.score - 0.5) - Math.abs(b.score - 0.5));
      rows = []; const seen = new Set(); let bi = 0, ui = 0;
      while (rows.length < limit && (bi < best.length || ui < unsure.length)) {
        for (let k = 0; k < 3 && bi < best.length; k++, bi++) if (!seen.has(best[bi].item_id)) { seen.add(best[bi].item_id); rows.push(best[bi]); }
        if (ui < unsure.length && !seen.has(unsure[ui].item_id)) { seen.add(unsure[ui].item_id); rows.push(unsure[ui]); } ui++;
      }
      rows = rows.slice(0, limit);
    } else {
      const SO = { newest: (a, b) => (itemsById[b.item_id]?.posted_at || 0) - (itemsById[a.item_id]?.posted_at || 0), added: (a, b) => b.added - a.added, likes: (a, b) => (itemsById[b.item_id]?.likes || 0) - (itemsById[a.item_id]?.likes || 0) };
      votes.sort(SO[P.sort] || ((a, b) => b.score - a.score));
      rows = votes.slice(offset, offset + limit);
    }
    const items = rows.map((v) => { const it = itemsById[v.item_id]; if (!it) return null; return Object.assign({}, it, { t_score: v.score, t_label: v.label, why: v.why || {}, found_by: (v.found_by || []).slice(0, 6).map((f) => ({ query: f.query, source: srcNames[f.source] || f.source })) }); }).filter(Boolean);
    return { total, items };
  }

  async function insights(tid) {
    const t = await getTopic(tid); const sc = await scorer(t);
    const pos = [], neg = [];
    if (sc.pc) { const diff = {}; for (const k in sc.pc) diff[k] = (diff[k] || 0) + sc.pc[k]; if (sc.nc) for (const k in sc.nc) diff[k] = (diff[k] || 0) - 0.7 * sc.nc[k]; const ranked = Object.entries(diff).sort((a, b) => b[1] - a[1]); ranked.filter(([, v]) => v > 0).slice(0, 20).forEach(([k, v]) => pos.push({ feature: k, label: readable(k), weight: +v.toFixed(3) })); ranked.filter(([, v]) => v < 0).slice(-20).reverse().forEach(([k, v]) => neg.push({ feature: k, label: readable(k), weight: +v.toFixed(3) })); }
    const qstats = (t.queries || []).map((q) => ({ query: q.query, origin: q.origin, enabled: q.enabled ? 1 : 0, locked: q.locked ? 1 : 0, runs: q.runs || 0, found: q.found || 0, pos: q.pos || 0, neg: q.neg || 0, items: 0, precision: ((q.pos || 0) + 1) / ((q.pos || 0) + (q.neg || 0) + 2) }));
    const seedRows = (t.seeds || []).map((s) => ({ query: s, origin: 'seed', enabled: 1, locked: 0, runs: 0, found: 0, pos: 0, neg: 0, items: 0, precision: 0.5 }));
    return { queries: seedRows.concat(qstats), likes: pos, dislikes: neg, authors: await likedAuthors(tid), n_pos: sc.nPos, n_neg: sc.nNeg, creators: Object.values(t.settings.creators || {}), anti: t.settings.anti || [], prefs: t.settings.prefs || {}, model: sc.nPos + sc.nNeg ? 'profile' : 'matching only', semantic: false };
  }
  async function likedAuthors(tid) {
    const votes = await topicItems(tid); const itemsById = {}; (await idb.all('items')).forEach((i) => itemsById[i.id] = i);
    const by = {}; votes.filter((v) => v.label).forEach((v) => { const it = itemsById[v.item_id]; if (!it || !it.author) return; const k = it.author + '|' + it.platform; by[k] = by[k] || { author: it.author, platform: it.platform, author_url: it.author_url, pos: 0, neg: 0 }; v.label > 0 ? by[k].pos++ : by[k].neg++; });
    return Object.values(by).filter((a) => a.pos >= 2 && a.pos > 2 * a.neg).sort((a, b) => b.pos - a.pos).slice(0, 20);
  }

  async function related(allItems, id) {
    const it = allItems.find((x) => x.id === id); if (!it) return { items: [], terms: [] };
    const words = [...new Set(((it.text || '') + ' ' + (it.hashtags || '')).toLowerCase().match(/[\p{L}]{4,}/gu) || [])].filter((w) => !STOP.has(w)).slice(0, 14);
    const res = L.runSearch(allItems, new URLSearchParams({ q: words.join(' OR '), limit: 13 }).toString());
    return { items: res.items.filter((x) => x.id !== id).slice(0, 12).map((x) => Object.assign({}, x, { why: ['words'] })), terms: words.slice(0, 5) };
  }

  // ── reasons / anti ────────────────────────────────────────────
  const REASON_PREFS = { short: 'avoid_short', long: 'avoid_long', ai: 'no_ai', ad: 'no_ads' };
  const REASON_ANTI = { ai: ['ai', 'aigenerated', 'generated', 'midjourney', 'sora', 'veo'], ad: ['ad', 'ads', 'advert', 'sponsored', 'promo', 'discount', 'sale'] };
  async function applyReasons(tid, iid, reasons, vote) {
    const t = await getTopic(tid); const st = t.settings;
    st.prefs = st.prefs || {}; st.anti = st.anti || []; st.reasons_recent = st.reasons_recent || [];
    for (let r of (reasons || [])) {
      const key = String(r).trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (!key) continue;
      if (REASON_PREFS[key]) { st.prefs[REASON_PREFS[key]] = true; (REASON_ANTI[key] || []).forEach((w) => { if (!st.anti.includes(w)) st.anti.push(w); }); }
      else if (['unrelated', 'dislike', 'notmytype', 'low quality', 'lowquality'].includes(key)) { /* the 👎 teaches it */ }
      else { key.split(' ').forEach((w) => { if (w.length > 1 && !st.anti.includes(w)) st.anti.push(w); }); st.reasons_recent = [key].concat(st.reasons_recent.filter((x) => x !== key)).slice(0, 12); }
    }
    st.anti = st.anti.slice(0, 60);
    await saveTopic(t);
    if (vote !== undefined && vote !== null) await voteItem(tid, iid, vote); else await rescore(tid);
    return { prefs: st.prefs, anti: st.anti, reasons_recent: st.reasons_recent };
  }

  async function voteItem(tid, iid, label) {
    label = label > 0 ? 1 : label < 0 ? -1 : 0;
    const k = voteKey(tid, iid); let v = await idb.get('votes', k);
    if (!v) v = { k, topic_id: tid, item_id: iid, label: 0, score: 0, why: {}, added: now(), found_by: [] };
    v.label = label; v.labeled_at = now(); await idb.put('votes', v);
    // update per-query precision tallies
    const t = await getTopic(tid);
    (v.found_by || []).forEach((f) => { const q = (t.queries || []).find((x) => x.query === f.query); if (q) { if (label > 0) q.pos = (q.pos || 0) + 1; else if (label < 0) q.neg = (q.neg || 0) + 1; } });
    await saveTopic(t);
    await rescore(tid);
    const votes = await topicItems(tid);
    return { n: votes.length, pos: votes.filter((x) => x.label > 0).length, neg: votes.filter((x) => x.label < 0).length };
  }

  function counts(votes) { return { n: votes.length, pos: votes.filter((v) => v.label > 0).length, neg: votes.filter((v) => v.label < 0).length, unrated: votes.filter((v) => !v.label).length, good: votes.filter((v) => !v.label && v.score >= 0.5).length }; }

  // ── the topics request router (mirrors the server) ────────────
  L.learn = {
    autoRefresh,
    async vote(tid, iid, label) { return voteItem(tid, iid, label); },
    async itemTopics(iid) { const out = []; for (const t of await allTopics()) { const v = await idb.get('votes', voteKey(t.id, iid)); if (v) out.push({ topic_id: t.id, name: t.name, label: v.label, score: v.score }); } return out; },
    async onItemDeleted(iid) { const vs = (await idb.all('votes')).filter((v) => v.item_id === iid); for (const v of vs) await idb.del('votes', v.k); },
    related,
    async request(method, parts, qs, body) {
      const arg = parts[1], sub = parts[2];
      if (!arg) {
        if (method === 'GET') { const out = []; for (const t of await allTopics()) out.push(await dto(t)); return { topics: out.sort((a, b) => (b.last_run || b.created) - (a.last_run || a.created)) }; }
        if (method === 'POST') { const seeds = (body.seeds || [body.name]).map((s) => String(s).trim()).filter(Boolean); const t = { id: uid(), name: (body.name || seeds[0]).slice(0, 80), seeds, sources: body.sources || [], settings: Object.assign({}, DEF, body.settings || {}), queries: [], created: now(), last_run: null }; await saveTopic(t); if (body.run !== false) { const j = L.newJob('topic', 'topic · ' + t.name); j.topic_id = t.id; L.runSafe(j, () => runTopic(t.id, j)); } return await dto(t); }
      }
      const t = await getTopic(arg); if (!t) return { error: 'not found' };
      if (!sub) {
        if (method === 'GET') return await dto(t);
        if (method === 'PATCH') { if (body.name != null) t.name = String(body.name).slice(0, 80); if (body.seeds) t.seeds = body.seeds.map((s) => s.trim()).filter(Boolean); if (body.sources) t.sources = body.sources; if (body.settings) t.settings = Object.assign({}, t.settings, body.settings); await saveTopic(t); await rescore(t.id); return await dto(t); }
        if (method === 'DELETE') { for (const v of await topicItems(arg)) await idb.del('votes', v.k); await idb.del('topics', arg); return { ok: true }; }
      }
      if (sub === 'run' && method === 'POST') { const j = L.newJob('topic', 'topic · ' + t.name); j.topic_id = t.id; L.runSafe(j, () => runTopic(t.id, j)); return L.jobDict(j); }
      if (sub === 'feed') return await feed(arg, qs);
      if (sub === 'vote' && method === 'POST') { if (body.reasons) { const r = await applyReasons(arg, String(body.item_id), body.reasons, body.label != null ? +body.label : -1); return { counts: counts(await topicItems(arg)), applied: r }; } return { counts: await voteItem(arg, String(body.item_id), +body.label) }; }
      if (sub === 'insights') return await insights(arg);
      if (sub === 'queries' && method === 'POST') { const act = body.action, q = String(body.query || '').trim(); t.queries = t.queries || []; if (act === 'add') { if (!t.queries.some((x) => x.query.toLowerCase() === q.toLowerCase())) t.queries.push({ query: q, origin: 'user', enabled: true, locked: true, runs: 0, found: 0, pos: 0, neg: 0 }); } else { const row = t.queries.find((x) => x.query === q); if (row) { if (act === 'delete') t.queries = t.queries.filter((x) => x !== row); else { row.enabled = act === 'enable'; row.locked = true; } } } await saveTopic(t); await rescore(arg); return { ok: true }; }
      if (sub === 'reason' && method === 'DELETE') { const P = Object.fromEntries(new URLSearchParams(qs)); if (P.anti) t.settings.anti = (t.settings.anti || []).filter((w) => w !== P.anti); if (P.pref) delete (t.settings.prefs || {})[P.pref]; await saveTopic(t); await rescore(arg); return { ok: true }; }
      if (sub === 'person' && method === 'POST') return personVerdict(t, body || {});
      if (sub === 'creator' && method === 'POST') return creator(t, body || {});
      if (sub === 'creator' && method === 'DELETE') { const P = Object.fromEntries(new URLSearchParams(qs)); const c = Object.assign({}, t.settings.creators || {}); delete c[String(P.handle || '').toLowerCase()]; t.settings.creators = c; await saveTopic(t); return { ok: true }; }
      if (sub === 'follow' || sub === 'more') return { error: 'this needs the local PC server' };
      return { error: 'topic route not available in browser: ' + parts.join('/') };
    },
  };
  // ── person dossiers: 'not them' drops an account (and all its posts) from the dossier for good;
  //    'them' confirms an account as the person; 'restore' undoes a 'not them'.
  async function personVerdict(t, body) {
    const p = Object.assign({}, t.settings.person || {}); const account = String(body.account || '').replace(/^@/, ''); const key = account.toLowerCase();
    let bad = (p.not_them || []).map(String); let removed = 0;
    if (body.action === 'not_them') {
      if (!bad.some((b) => b.toLowerCase() === key)) bad.push(account);
      const [author, plat] = account.split('|');
      for (const v of await topicItems(t.id)) { const it = await idb.get('items', v.item_id); if (it && String(it.author || '').toLowerCase() === (author || '').toLowerCase() && (it.platform || '') === (plat || '')) { await idb.del('votes', v.k); removed++; } }
      p.not_them = bad;
    } else if (body.action === 'restore') { p.not_them = bad.filter((b) => b.toLowerCase() !== key); }
    else if (body.action === 'them') { p.not_them = bad.filter((b) => b.toLowerCase() !== key); if (body.item_id) await voteItem(t.id, String(body.item_id), 1); }
    else return { error: 'unknown verdict' };
    t.settings.person = p; await saveTopic(t); await rescore(t.id);
    return { ok: true, action: body.action, account, removed, not_them: p.not_them || [], counts: counts(await topicItems(t.id)) };
  }

  // ── a creator for this topic: one @account on one network. Their own posts are pulled through the
  //    Worker (/account) and linked to the topic; what they post about becomes soft signal + searches.
  //    X / Instagram / TikTok need a login, so they're PC-server only.
  const WORKER_ACCOUNT = new Set(['mastodon', 'bluesky', 'reddit', 'youtube', 'lemmy']);
  function creator(t, body) {
    let handle = String(body.handle || body.author || '').trim(), platform = String(body.platform || '').toLowerCase();
    const m = handle.match(/^https?:\/\/(?:www\.)?([^/]+)\/(?:profile\/|user\/|@)?([^/?#]+)/i);
    if (m) { const dom = m[1]; handle = m[2]; platform = /bsky/.test(dom) ? 'bluesky' : /youtu/.test(dom) ? 'youtube' : /reddit/.test(dom) ? 'reddit' : /x\.com|twitter/.test(dom) ? 'x' : /instagram/.test(dom) ? 'instagram' : /tiktok/.test(dom) ? 'tiktok' : 'mastodon'; if (platform === 'mastodon' && !handle.includes('@')) handle += '@' + dom; }
    handle = handle.replace(/^@/, '');
    if (!handle) return { error: 'enter a username or profile link' };
    if (!platform) platform = handle.includes('@') ? 'mastodon' : /\.bsky\.social$|\./.test(handle) ? 'bluesky' : 'x';
    if (!WORKER_ACCOUNT.has(platform)) return { error: platform + ' needs a login to read a profile — run the PC server (SETUP → cookies) for ' + platform + ' accounts. Mastodon, Bluesky, Reddit and YouTube work from the browser.' };
    const j = L.newJob('creator', 'profile @' + handle); j.topic_id = t.id;
    L.runSafe(j, async () => {
      j.total = 3; j.log('◎ learning @' + handle + ' (' + platform + ') for this topic');
      const pid = handle + '|' + platform;
      const mj = await L.people.request('POST', ['people', pid, 'more'], '', { limit: 40, media: t.settings.media === 'video' ? 'video' : 'all' });
      if (mj.error) throw new Error(mj.error);
      for (let i = 0; i < 90; i++) { const r = L.jobs[mj.id]; if (!r || !['running', 'queued'].includes(r.state)) { if (r && r.state === 'error') throw new Error((r.log_lines || []).slice(-1)[0] || 'could not read the account'); break; } await new Promise((x) => setTimeout(x, 400)); }
      j.done = 1;
      const items = (await idb.all('items')).filter((it) => String(it.author || '').toLowerCase() === handle.toLowerCase() && it.platform === platform);
      for (const it of items) await link(t.id, it.id, '@' + handle, 'creator');
      j.done = 2; j.stats.found = items.length; j.stats.linked = items.length;
      // what they post about → soft keywords + searches (same as the server's creator profile)
      const tagC = {}; items.forEach((it) => String(it.hashtags || '').toLowerCase().split(/\s+/).filter(Boolean).forEach((h) => tagC[h] = (tagC[h] || 0) + 1));
      const topTags = Object.entries(tagC).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h);
      const t2 = await getTopic(t.id);
      t2.settings.creators = Object.assign({}, t2.settings.creators || {}, { [handle.toLowerCase()]: { handle, platform, n: items.length, top_hashtags: topTags, added: now() } });
      if (!t2.settings.person) {   // a person dossier stays on the person: no topic-wide searches grown from what they post about
        t2.settings.soft = [...new Set((t2.settings.soft || []).concat(topTags.slice(0, 4)))];
        t2.queries = t2.queries || [];
        for (const q of ['@' + handle].concat(topTags.slice(0, 3).map((h) => '#' + h))) if (!t2.queries.some((x) => x.query.toLowerCase() === q.toLowerCase())) t2.queries.push({ query: q, origin: 'creator', enabled: true, locked: false, runs: 0, found: 0, pos: 0, neg: 0, created: now() });
      }
      await saveTopic(t2); await rescore(t.id);
      j.done = 3; j.result = { handle, platform, collected: items.length, profile: { top_hashtags: topTags } };
      j.log('  done: ' + items.length + ' posts, ' + topTags.length + ' hashtags learned');
    });
    return L.jobDict(j);
  }

  // ── auto-update: topics with an Auto-refresh setting keep collecting while the app is open.
  //    (The PC server has a real scheduler; in browser mode this is it.)
  async function autoRefresh() {
    if (!L.enabled) return [];
    const s = await L.settings(); if (!s.worker_url) return [];
    const ran = [];
    for (const t of await allTopics()) {
      const hrs = +((t.settings || {}).refresh_hours || 0); if (!hrs) continue;
      if (now() - (t.last_run || 0) < hrs * 3600) continue;
      if (Object.values(L.jobs || {}).some((j) => j.topic_id === t.id && (j.state === 'running' || j.state === 'queued'))) continue;
      const j = L.newJob('topic', 'auto-update · ' + t.name); j.topic_id = t.id; L.runSafe(j, () => runTopic(t.id, j)); ran.push(t.id);
    }
    return ran;
  }
  setTimeout(() => autoRefresh().catch(() => {}), 15000);
  setInterval(() => { if (!document.hidden) autoRefresh().catch(() => {}); }, 5 * 60 * 1000);

  async function dto(t) { const votes = await topicItems(t.id); return { id: t.id, name: t.name, seeds: t.seeds, sources: t.sources || [], settings: Object.assign({}, DEF, t.settings), model: {}, created: t.created, last_run: t.last_run, counts: counts(votes), running: Object.values(L.jobs || {}).some((j) => j.topic_id === t.id && (j.state === 'running' || j.state === 'queued')) }; }
})();
