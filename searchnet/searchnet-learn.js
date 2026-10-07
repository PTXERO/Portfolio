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
          const alpha = Math.min(0.85, n / (n + 4)) * (n >= 4 ? 1 : 0.7);   // under four votes the model only leans
          final = (1 - alpha) * prior + alpha * learned;
          why.model = +learned.toFixed(3);
          // why-not: item words with negative profile weight
          if (nc) { const lower = []; for (const k of Object.keys(x)) { if ((k[0] === 'w' || k[0] === '#') && nc[k] && (!pc || !pc[k])) lower.push(k); } why._lowerRaw = lower; }
        }
        const have = itemStems(it); const flags = [];
        if (anti.size) { const hit = [...anti].filter((a) => have.has(a)); if (hit.length) { final *= Math.max(0.1, 1 - 0.6 * Math.min(3, hit.length)); flags.push(...hit.slice(0, 3)); why.anti = hit.slice(0, 3); } }
        if (pc) {   // why it scores up: this post's own words that liked posts share (and disliked ones don't)
          const x2 = feats(it); const up = [];
          for (const k of Object.keys(x2)) if ((k[0] === 'w' || k[0] === '#') && pc[k] && !(nc && nc[k] > pc[k])) up.push([x2[k] * pc[k], k]);
          up.sort((a, b) => b[0] - a[0]); const r2 = up.slice(0, 4).map(([, k]) => readable(k)).filter((w) => !seedStems.has(stem(String(w).replace(/^[#@]/, ''))));
          if (r2.length) why.raise = r2.slice(0, 3);
        }
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
  // ── what counts as "in" the topic (the web, the dossier): 👍 always; unrated only when the score clears the bar
  //    and no anti keyword hit; 👎 never. The bar sits between what you liked and what you didn't once both exist.
  function threshold(votes) {
    const pos = votes.filter((v) => v.label > 0 && v.score != null), neg = votes.filter((v) => v.label < 0 && v.score != null);
    if (pos.length >= 3 && neg.length >= 3) { const m = (a) => a.reduce((s, v) => s + v.score, 0) / a.length; return clip((m(pos) + m(neg)) / 2, 0.35, 0.65); }
    return 0.5;
  }
  function isMember(v, tau) { if (!v) return false; if (v.label > 0) return true; if (v.label < 0) return false; if (v.why && v.why.anti && v.why.anti.length) return false; return (v.score || 0) >= tau; }
  // this post's own distinctive words: the chips offered when a vote needs a reason
  function distinctTerms(it, t) {
    const seedStems = new Set(); (t.seeds || []).concat(t.settings.soft || [], t.settings.anti || []).forEach((s) => tokens(s).forEach((w) => seedStems.add(stem(w))));
    const out = []; const seen = new Set();
    ((it.hashtags || '').toLowerCase().split(/\s+/).filter(Boolean).concat(((it.text || '').match(/#(\w+)/g) || []).map((h) => h.slice(1).toLowerCase()))).forEach((h) => { if (!seedStems.has(stem(h)) && !seen.has(h)) { seen.add(h); out.push('#' + h); } });
    const freq = {}; tokens(it.text).forEach((w) => { if (w.length > 3 && !STOP.has(w) && !seedStems.has(stem(w))) freq[w] = (freq[w] || 0) + 1; });
    Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).forEach(([w]) => { if (!seen.has(w)) { seen.add(w); out.push(w); } });
    return out.slice(0, 8);
  }

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
    job.topic_id = tid; job.log('◎ ' + t.name + (person ? ': person dossier, the accounts\' own feeds' : ': expanding searches'));
    if (!person) await expand(tid);
    const t2 = await getTopic(tid);
    const queries = (t2.queries || []).filter((q) => q.enabled).map((q) => q.query);
    const seeds = t2.seeds || [];
    let runQs = [...new Set(seeds.concat(queries))].slice(0, 3 + 2 * (t2.settings.breadth || 3));
    // a source that switched itself off gets one try a week later
    for (const s of (await L.request('/api/sources')).sources) { if (!s.enabled && s.auto_off && now() - s.auto_off > 7 * 86400) { await L.request('/api/sources/' + s.id, { method: 'PATCH', body: { enabled: true } }); job.log('  retrying ' + s.name + ' (switched itself off a week ago)'); } }
    let srcs = (await L.request('/api/sources')).sources.filter((s) => s.enabled && s.searchable);
    if (person && person.mode === 'account') {        // one @account: its own feed + 'from:' searches only (Bluesky supports them)
      runQs = runQs.filter((q) => /^from:/i.test(q)); srcs = srcs.filter((s) => s.source === 'bluesky');
    } else if (person) {                               // a name: quoted-name searches only, never grown keywords
      runQs = runQs.filter((q) => q.startsWith('"') || /^from:/i.test(q) || q.toLowerCase() === [person.first, person.last].filter(Boolean).join(' ').toLowerCase());
    }
    const plan = t2.settings.plan;
    if (plan && plan.auto && (plan.presets || []).length) { const fresh = planFor(t2.seeds, t2.settings, (await L.request('/api/sources')).sources); const keep = fresh.source_ids.filter((id) => !(plan.dropped || {})[id]); t2.sources = keep; t2.settings.plan = Object.assign({}, plan, { source_ids: keep }); await saveTopic(t2); }
    if (t2.sources && t2.sources.length) srcs = srcs.filter((s) => t2.sources.includes(s.id));
    job.total = Math.max(1, runQs.length * srcs.length + 2);
    job.log('  ' + runQs.length + ' searches × ' + srcs.length + ' sources');
    const seen = new Set();
    // collect directly (synchronously), then link everything matching
    await collectForTopic(t2, runQs, srcs, job, seen);
    // full text for the articles in this topic (titles and snippets are too thin for names and briefs)
    try {
      const votes = (await topicItems(tid)).filter((v) => v.label >= 0).sort((a, b) => (b.label - a.label) || (b.score - a.score));
      let read = 0, writers = 0;
      for (const v of votes) {
        if (read >= 15 || job.cancel) break;
        const it = await idb.get('items', v.item_id);
        if (!it || !ARTICLE_PLATFORMS.has(it.platform) || it.platform === 'archive' || !/^http/.test(it.url || '') || it.body_at || String(it.text || '').length >= 600) continue;
        it.body_at = now(); await idb.put('items', it);
        try { const art = await L.workerCall('/article?url=' + encodeURIComponent(it.url)); it.byline = art.byline || []; it.dateline = art.dateline || ''; if (art.text && art.text.length > String(it.text || '').length) { it.text = (String(it.text || '').split('\n')[0] + '\n\n' + art.text).slice(0, 8000); if (!it.posted_at && art.published) it.posted_at = art.published; read++; } await idb.put('items', it);
          // the outlet's own page for the writer (handles it lists, the bio it prints): read once per writer
          if (it.byline.length && art.author_url && writers < 8) { const key = 'author:' + it.byline[0].toLowerCase(); if (!(await idb.get('kv', key))) { const page = await L.workerCall('/author?url=' + encodeURIComponent(art.author_url)); page.outlet = it.author || ''; await idb.put('kv', { k: key, v: page, ts: now() }); writers++; } }
        } catch (e) { /* next */ }
      }
      if (read || writers) job.log('  read ' + read + ' full articles' + (writers ? ', ' + writers + ' writer pages' : ''));
    } catch (e) { /* enrichment only */ }
    // grown searches that keep bringing junk are switched off (yours never are)
    (t2.queries || []).forEach((q) => { const n = (q.pos || 0) + (q.neg || 0); if (q.enabled && !['seed', 'user'].includes(q.origin) && n >= 6 && (q.pos || 0) / n < 0.25) { q.enabled = false; job.log("  search '" + q.query + "' switched off: " + q.neg + ' of ' + n + ' rated 👎'); } });
    // which sites talked about it (news / web results) → offered as sources in the dossier
    try {
      const sites = Object.assign({}, t2.settings.sites || {}); let added = 0;
      for (const id of seen) { const it = await idb.get('items', id); if (!it || !ARTICLE_PLATFORMS.has(it.platform) || !it.url) continue; let host = ''; try { host = new URL(it.url).hostname.replace(/^www\./, ''); } catch (e) { continue; } if (!host || /google\.com$|bing\.com$/.test(host)) continue; const s = sites[host] = sites[host] || { n: 0, first: now() }; s.n++; s.last = now(); if (!s.title && it.author_name) s.title = it.author_name; added++; }
      if (added) { t2.settings.sites = sites; await saveTopic(t2); job.log('  ' + Object.keys(sites).length + ' sites mention it (dossier → SITES)'); }
    } catch (e) { /* tally only */ }
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
    // the badge on the topic card: is it moving, is it heated (the full read is dossier → SIGNALS)
    try { const sig = await signals(tid); t2.settings.signal = Object.assign({}, sig.badge, { headline: sig.headline, at: now() }); job.log('  signals: ' + sig.headline); } catch (e) { job.log('  signals skipped: ' + e.message); }
    t2.last_run = now(); await saveTopic(t2);
    job.result = { topic_id: tid, new: seen.size, queries: runQs };
  }
  async function collectForTopic(t, runQs, srcs, job, seen) {
    srcs = srcs.slice();
    const h = await L.hub(); let budget = +t.settings.max_fetches || (h && h.kind === 'shared' ? 60 : 150); let spent = 0;   // fetches per run (the shared hub has daily limits)
    if (!t.settings.max_fetches && h && h.kind === 'shared' && window.PX) { try { const me = await window.PX.me(); const left = me.limits ? me.limits.fetch - (me.today.fetch || 0) : 1e9; budget = me.owner || left > 2000 ? 150 : Math.max(20, Math.min(60, Math.floor(left / 2))); } catch (e) { /* keep default */ } }
    const byUrl = new Map(); for (const it of await idb.all('items')) if (it.url && ARTICLE_PLATFORMS.has(it.platform)) byUrl.set(it.url, it.id);
    for (const q of runQs) {
      for (const s of srcs.slice()) {
        if (job.cancel) return;
        if (spent >= budget) { job.log('  stopped at ' + budget + ' fetches this run (Settings → results per search, or your own hub, raises it)'); await saveTopic(t); return; }
        spent++;
        try {
          const params = new URLSearchParams({ source: s.source, q, limit: t.settings.per_query || 20, media: t.settings.media || 'video' });
          const days = windowDays(t.settings, t.settings.plan); if (days) params.set('since', String(now() - days * 86400));
          if (s.value && s.param === 'instance') params.set('instance', s.value);
          if (s.value && s.param === 'url') params.set('url', s.value);          // feeds and 'Any site' templates carry their URL
          if (s.value && s.param === 'qx') params.set('qx', s.value);            // Obituaries / Schools / local news: extra terms on every query
          if (s.value && s.param === 'boards') params.set('boards', s.value);
          const r = await workerSearch(params);
          const q2 = (t.queries || []).find((x) => x.query === q);
          let found = 0; t.settings.source_stats = t.settings.source_stats || {}; const ss = t.settings.source_stats[s.id] = t.settings.source_stats[s.id] || { runs: 0, found: 0, pos: 0, neg: 0 }; if (!(t._runSeen = t._runSeen || new Set()).has(s.id)) { t._runSeen.add(s.id); ss.runs++; }
          const since = (windowDays(t.settings, t.settings.plan) || 0) ? now() - windowDays(t.settings, t.settings.plan) * 86400 : 0;
          for (const it of (r.items || [])) {
            if (!it.id) continue;
            if (since && it.posted_at && it.posted_at < since) continue;      // older than the topic's time window
            if (it.url && ARTICLE_PLATFORMS.has(it.platform)) { const dup = byUrl.get(it.url); if (dup && dup !== it.id) it.id = dup; else byUrl.set(it.url, it.id); }   // the same page from another engine is one item
            it.collected_at = now();
            if (!(await idb.get('items', it.id))) { await idb.put('items', it); }
            await link(t.id, it.id, q, s.id); seen.add(it.id); found++;
          }
          if (q2) { q2.runs++; q2.found += found; }
          ss.found += found;
          job.stats.found += found; job.log('  ' + found + ' · ' + q + ' @ ' + s.name);
        } catch (e) { job.stats.errors++; job.log('  ✕ ' + s.name + ': ' + e.message); if (await L.markFailed(s.id, e.message)) { job.log('    ' + s.name + ' switched off until you turn it back on (SOURCES)'); srcs = srcs.filter((x) => x.id !== s.id); } }
        job.done++;
      }
    }
    delete t._runSeen;
    // per-source votes → the plan drops what never pays off
    const votes = await topicItems(t.id); const stats = t.settings.source_stats || {}; Object.values(stats).forEach((s) => { s.pos = 0; s.neg = 0; });
    votes.forEach((v) => (v.found_by || []).forEach((f) => { const s = stats[f.source]; if (!s) return; if (v.label > 0) s.pos++; else if (v.label < 0) s.neg++; }));
    const byId = {}; srcs.forEach((s) => byId[s.id] = s);
    const keep = prunePlan(t.settings.plan, stats, byId);
    if (keep && keep.length !== (t.sources || []).length) { Object.entries(t.settings.plan.dropped).forEach(([sid, why]) => { if ((t.sources || []).includes(sid)) job.log('  dropped from this topic: ' + why); }); t.sources = keep; t.settings.plan.source_ids = keep; }
    await saveTopic(t);
  }
  async function workerSearch(params) { return L.workerCall('/search?' + params); }
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
      if (vote > 0) { st.soft = st.soft || []; const w = key.replace(/^#/, ''); if (w.length > 1 && !st.soft.includes(w)) st.soft.push(w); st.soft = st.soft.slice(0, 40); st.anti = st.anti.filter((a) => a !== w); continue; }   // 👍 + why → a soft keyword
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
    const expected = v.score || 0;
    v.label = label; v.labeled_at = now(); await idb.put('votes', v);
    // update per-query precision tallies
    const t = await getTopic(tid);
    // a vote the model did not see coming: ask why, offering this post's own words
    let surprise = null;
    if ((label > 0 && expected < 0.35) || (label < 0 && expected > 0.65)) { const it = await idb.get('items', iid); surprise = { expected: +expected.toFixed(2), terms: it ? distinctTerms(it, t) : [] }; }
    (v.found_by || []).forEach((f) => { const q = (t.queries || []).find((x) => x.query === f.query); if (q) { if (label > 0) q.pos = (q.pos || 0) + 1; else if (label < 0) q.neg = (q.neg || 0) + 1; } });
    await saveTopic(t);
    await rescore(tid);
    const votes = await topicItems(tid);
    return { n: votes.length, pos: votes.filter((x) => x.label > 0).length, neg: votes.filter((x) => x.label < 0).length, surprise };
  }

  function counts(votes) { return { n: votes.length, pos: votes.filter((v) => v.label > 0).length, neg: votes.filter((v) => v.label < 0).length, unrated: votes.filter((v) => !v.label).length, good: votes.filter((v) => !v.label && v.score >= 0.5).length }; }

  // ── the topics request router (mirrors the server) ────────────
  L.learn = {
    autoRefresh, threshold, isMember, distinctTerms, kindOf, looksLikeName, planFor, windowDays,
    async vote(tid, iid, label) { return voteItem(tid, iid, label); },
    async itemTopics(iid) { const out = []; for (const t of await allTopics()) { const v = await idb.get('votes', voteKey(t.id, iid)); if (v) out.push({ topic_id: t.id, name: t.name, label: v.label, score: v.score }); } return out; },
    async onItemDeleted(iid) { const vs = (await idb.all('votes')).filter((v) => v.item_id === iid); for (const v of vs) await idb.del('votes', v.k); },
    related,
    async request(method, parts, qs, body) {
      const arg = parts[1], sub = parts[2];
      if (!arg) {
        if (method === 'GET') { const out = []; for (const t of await allTopics()) out.push(await dto(t)); return { topics: out.sort((a, b) => (b.last_run || b.created) - (a.last_run || a.created)) }; }
        if (method === 'POST') { const seeds = (body.seeds || [body.name]).map((s) => String(s).trim()).filter(Boolean); const t = { id: uid(), name: (body.name || seeds[0]).slice(0, 80), seeds, sources: body.sources || [], settings: Object.assign({}, DEF, body.settings || {}), queries: [], created: now(), last_run: null }; if (!(body.sources || []).length) { const p = planFor(seeds, t.settings, (await L.request('/api/sources')).sources); t.settings.plan = p; t.sources = p.source_ids; } t.settings.visibility = visibilityFor(t); await saveTopic(t); if (body.run !== false) { const j = L.newJob('topic', 'topic · ' + t.name); j.topic_id = t.id; L.runSafe(j, () => runTopic(t.id, j)); } return await dto(t); }
      }
      const t = await getTopic(arg); if (!t) return { error: 'not found' };
      if (!sub) {
        if (method === 'GET') return await dto(t);
        if (method === 'PATCH') { if (body.name != null) t.name = String(body.name).slice(0, 80); if (body.seeds) t.seeds = body.seeds.map((s) => s.trim()).filter(Boolean); if (body.sources) { t.sources = body.sources; if (t.settings.plan && t.settings.plan.auto && !(body.settings || {}).plan) t.settings.plan = Object.assign({}, t.settings.plan, { auto: false, note: 'chosen by hand' }); } if (body.settings) t.settings = Object.assign({}, t.settings, body.settings); if (body.seeds || body.settings) { if (body.seeds && t.settings.plan) t.settings.plan = Object.assign({}, t.settings.plan, { kind: kindOf(t.seeds, t.settings)[0] }); t.settings.visibility = visibilityFor(t); } await saveTopic(t); await rescore(t.id); return await dto(t); }
        if (method === 'DELETE') { for (const v of await topicItems(arg)) await idb.del('votes', v.k); await idb.del('topics', arg); return { ok: true }; }
      }
      if (sub === 'run' && method === 'POST') { const j = L.newJob('topic', 'topic · ' + t.name); j.topic_id = t.id; L.runSafe(j, () => runTopic(t.id, j)); return L.jobDict(j); }
      if (sub === 'feed') return await feed(arg, qs);
      if (sub === 'brief') return await brief(arg);
      if (sub === 'signals') return await signals(arg);
      if (sub === 'plan' && method === 'POST') { const p = planFor(t.seeds, t.settings, (await L.request('/api/sources')).sources); t.settings.plan = p; t.sources = p.source_ids; await saveTopic(t); return await dto(t); }
      if (sub === 'vote' && method === 'POST') { if (body.reasons) { const r = await applyReasons(arg, String(body.item_id), body.reasons, body.label != null ? +body.label : -1); return { counts: counts(await topicItems(arg)), applied: r }; } const vr = await voteItem(arg, String(body.item_id), +body.label); return { counts: vr, surprise: vr.surprise }; }
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
  // ── what a topic is about → which sources fit it (mirror of server/rv/plan.py) ──
  const EVENT_WORDS = new Set('hurricane storm tornado earthquake flood wildfire fire shooting election protest riot crash war strike outbreak verdict trial explosion arrest ceasefire attack evacuation blackout recall scandal lawsuit indictment summit fest festival con convention conference expo concert tour cup championship tournament gala parade marathon awards finals playoffs premiere launch'.split(' '));
  const TECH_WORDS = new Set('api software linux python javascript typescript rust golang kernel gpu cpu llm ai model crypto bitcoin ethereum startup app github framework database sql server cloud docker kubernetes firmware chip semiconductor open-source opensource'.split(' '));
  const PLACE_WORDS = new Set('county city town village parish borough district beach island valley harbor harbour bay lake river mountain park street avenue neighborhood neighbourhood'.split(' '));
  const ORG_WORDS = new Set('university college school hospital church company inc llc corp corporation department police bank airport stadium museum hotel restaurant club band fc records studio studios league group labs foundation association society institute magazine radio podcast network press times news gazette journal herald'.split(' '));
  const STATES = new Set('alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming york jersey carolina dakota hampshire mexico london paris berlin tokyo toronto sydney chicago houston miami tampa orlando atlanta boston seattle denver dallas austin phoenix detroit philadelphia nashville orleans angeles francisco vegas'.split(' '));
  const WINDOW_DAYS = { event: 14, place: 90, person: 0, handle: 0, tech: 0, general: 0 };   // 0 = everything
  function windowDays(st, plan) { const w = String((st || {}).window || 'auto'); if (w === 'auto') return +((plan || {}).window_days || 0); return w === 'all' ? 0 : Math.max(0, +w || 0); }
  const PLANS = {
    person: [['news', 'web', 'obituaries', 'schools', 'archive', 'blogs', 'mastodon', 'bluesky', 'reddit', 'youtube', 'lemmy'], 'a name: papers, obituaries, school and local sites, social posts under the quoted name'],
    event: [['news', 'gdelt', 'web', 'reddit', 'mastodon', 'bluesky', 'youtube', 'wikipedia', 'fourchan', 'blogs', 'lemmy'], 'an event: news first, then what people posted about it'],
    place: [['news', 'web', 'reddit', 'youtube', 'mastodon', 'bluesky', 'schools', 'wikipedia', 'blogs', 'lemmy'], 'a place: local news, local sites and schools, posts from there'],
    tech: [['hn', 'web', 'reddit', 'youtube', 'blogs', 'wikipedia', 'mastodon', 'lemmy', 'fourchan', 'news', 'bluesky'], 'technical: Hacker News, docs and blogs, forums, then news'],
    general: [['mastodon', 'lemmy', 'reddit', 'bluesky', 'youtube', 'news', 'gdelt', 'web', 'blogs', 'hn', 'archive', 'fourchan', 'wikipedia'], 'a general subject: everything except obituaries and schools'],
  };
  const NAME_RE = /^(?:(?:dr|mr|mrs|ms|prof|rev|sgt|lt|capt)\.?\s+)?[A-Z](?:[a-z'’.-]|['’][A-Z])+(?:\s+[A-Z](?:[a-z'’.-]|['’][A-Z])+){1,2}(?:\s+(?:jr|sr|ii|iii|iv)\.?)?$/;
  const words_ = (s) => String(s || '').toLowerCase().split(/[^a-z0-9#@'’.-]+/).filter(Boolean).map((w) => w.replace(/^[.'’]+|[.'’]+$/g, ''));
  function looksLikeName(seed) { const s = String(seed || '').trim().replace(/^"|"$/g, ''); if (!NAME_RE.test(s)) return false; return !words_(s).some((w) => EVENT_WORDS.has(w) || PLACE_WORDS.has(w) || ORG_WORDS.has(w) || STATES.has(w) || TECH_WORDS.has(w)); }
  // open by default; a topic about a named person is never open (private at most), whatever was asked
  function visibilityFor(t) { const st = t.settings || {}; const want = st.visibility || 'open'; const person = (st.person && st.person.mode !== 'account') || ((st.plan || {}).kind === 'person'); return person && want === 'open' ? 'private' : want; }
  function kindOf(seeds, settings) {
    settings = settings || {}; seeds = (seeds || []).filter(Boolean);
    if (settings.person) return [settings.person.mode === 'account' ? 'handle' : 'person', 'you chose PERSON'];
    const first = (seeds[0] || '').trim();
    if (first.startsWith('@') || /^from:/i.test(first)) return ['handle', 'an @account'];
    const ws = new Set(seeds.flatMap(words_));
    if (looksLikeName(first)) return ['person', `'${first}' reads like a person's name`];
    const has = (set) => [...ws].filter((w) => set.has(w)).sort();
    let h;
    if ((h = has(EVENT_WORDS)).length) return ['event', 'words like ' + h.slice(0, 2).join(', ')];
    if ((h = has(TECH_WORDS)).length) return ['tech', 'words like ' + h.slice(0, 2).join(', ')];
    if ((h = has(STATES).concat(has(PLACE_WORDS))).length) return ['place', 'names a place (' + h.slice(0, 2).join(', ') + ')'];
    return ['general', 'no strong signal in the words'];
  }
  function planFor(seeds, settings, sources) {
    const [kind, why] = kindOf(seeds, settings); const presets = kind === 'handle' ? [] : PLANS[kind][0];
    const ids = sources.filter((s) => s.enabled && s.searchable !== false && (presets.includes(s.preset) || !s.preset)).map((s) => s.id);
    return { kind, why, presets, source_ids: ids, dropped: {}, auto: true, window_days: WINDOW_DAYS[kind] || 0, note: kind === 'handle' ? 'one account, one network' : PLANS[kind][1] };
  }
  function prunePlan(plan, stats, byId) {
    if (!plan || !plan.auto) return null;
    const keep = [], dropped = Object.assign({}, plan.dropped || {});
    for (const sid of (plan.source_ids || [])) {
      const st = stats[sid] || {}; const runs = st.runs || 0, found = st.found || 0, pos = st.pos || 0, neg = st.neg || 0; const name = (byId[sid] || {}).name || sid;
      if (runs >= 3 && found === 0) dropped[sid] = name + ': nothing in ' + runs + ' runs';
      else if (pos + neg >= 6 && neg >= 0.85 * (pos + neg)) dropped[sid] = name + ': ' + neg + ' of ' + (pos + neg) + ' rated 👎';
      else keep.push(sid);
    }
    plan.dropped = dropped; return keep;
  }
  // ── a brief: the sentences that carry the topic's words, who and where, a timeline, with [n] citations ──

  // ── SIGNALS: patterns in a topic's posts, en masse. Is it growing, where it spread, who drove it, how heated,
  //    what kind of problem, which storylines run inside it, whether some of it looks coordinated.
  //    Every number carries the posts behind it. Counting, time, words; no model, no lookups. Mirrors server/rv/signals.py.
  const DAY = 86400;
  const REFERENCE = new Set(['archive', 'wikipedia']);   // old documents and encyclopedia pages: context, never the first voice or a driver
  const HEAT = new Set(('outrage outraged outrageous disgusting disgusted disgrace disgraceful shame shameful shameless boycott resign resigns resignation fired unacceptable scandal backlash protest protests protesters protesting lawsuit sue sued suing furious angry anger fury slam slams slammed blast blasts blasted condemn condemns condemned demand demands demanding accountability accountable corrupt corruption lies lied liar lying coverup cover-up racist racism sexist abuse abusive harassment threat threats threatened victim victims apology apologize apologizes apologized controversy controversial uproar ban banned petition wtf smh shocking horrifying horrific appalling appalled infuriating pathetic criminal illegal fraud hypocrite hypocrisy betrayed betrayal negligence negligent reckless outcry exposed caught fail failed failure cancel cancelled').split(' '));
  const ISSUES = {
    'safety / crime': 'shooting shot stabbing stabbed robbery robbed arrested arrest police murder homicide assault assaulted missing kidnapped shooter gunfire burglary theft stolen carjacking',
    'health': 'hospital hospitals outbreak overdose overdoses virus illness cancer disease infection infected contaminated poisoning sick measles flu covid mental suicide ambulance er',
    'housing': 'rent rents eviction evicted homeless homelessness housing landlord landlords tenants affordable mortgage foreclosure shelter',
    'environment / weather': 'flood flooding flooded pollution polluted toxic contaminated spill wildfire fire fires hurricane storm tornado heatwave drought sewage algae smoke evacuate evacuation',
    'jobs / labor': 'strike striking layoffs layoff laid wages wage union unions unemployment unemployed jobs hiring overtime walkout picket',
    'discrimination': 'racist racism discrimination discriminated hate bias bigotry slur harassment harassed sexism antisemitic islamophobic homophobic transphobic',
    'corruption / governance': 'corruption corrupt fraud bribe bribery indicted indictment scandal resign resigns ethics lawsuit sued audit misconduct embezzlement kickback',
    'infrastructure / outages': 'outage outages power blackout water main sewer bridge road closed closure internet down boil notice pothole potholes derailment collapse grid',
    'education': 'school schools teacher teachers students student board curriculum tuition classroom superintendent principal campus',
    'cost of living': 'prices price inflation gas groceries gouging bills bill afford cost costs expensive insurance premiums rates fees',
    'immigration': 'ice deportation deported deportations border migrants migrant asylum immigration immigrants raid raids detained detention',
  };
  const ISSUE_WORDS = Object.fromEntries(Object.entries(ISSUES).map(([k, v]) => [k, new Set(v.split(' '))]));
  // words that only mean trouble in context ("power", "fire", "school", "gas"): two of them in a post, or one of the plain ones
  const ISSUE_VAGUE = new Set('power main down internet water fire fires storm ice school schools board campus jobs price prices cost costs bills bill rates fees gas mental sick er missing hate bias border raid raids grid collapse closure closed bridge road shelter rent rents housing union unions students student teacher teachers insurance expensive afford spill smoke drought notice principal classroom tuition premiums groceries assault theft stolen police arrest arrested detained hospital hospitals disease virus flu covid cancer illness infection infected contaminated poisoning'.split(' '));
  const ISSUE_STRONG = new Set(Object.values(ISSUE_WORDS).flatMap((ws) => [...ws]).filter((w) => !ISSUE_VAGUE.has(w)));
  // !!! or a post mostly in capitals. A run of three capitalised words is a name or a title (A DAY TO REMEMBER), not a shout.
  function shouting(text) { const t = String(text || ''); if ((t.match(/!/g) || []).length >= 3) return true; const caps = (t.match(/[A-Za-z][A-Za-z'’-]{2,}/g) || []).filter((w) => !['HTTP', 'HTTPS', 'NEWS', 'USA', 'NYC'].includes(w.toUpperCase())).map((w) => w === w.toUpperCase()); const n = caps.filter(Boolean).length; return n >= 3 && n / Math.max(1, caps.length) >= 0.6; }   // mostly capitals: a shout. A few: names and titles.
  const dayOf = (ts) => Math.floor(ts / DAY);
  const ref = (it) => ({ id: it.id, url: it.url, text: String(it.text || '').slice(0, 120), author: it.author, platform: it.platform, posted_at: it.posted_at });
  const normWords = (t) => String(t || '').toLowerCase().replace(/https?:\/\/\S+|@\w+|#/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const OUT = () => L.OUTLETS || new Set(['news', 'web', 'archive', 'wikipedia']);
  const ents = (t, skip) => (L.entitiesIn ? L.entitiesIn(t, skip) : []);
  const ments = (t) => (L.mentionsIn ? L.mentionsIn(t) : []);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const median = (xs) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const top = (c, n) => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n);
  function sigTrend(items, horizon = 30) {
    const dated = items.filter((it) => it.posted_at && !REFERENCE.has(it.platform));
    if (!dated.length) return { series: [], state: 'undated', why: 'the posts carry no dates', bursts: [] };
    const end = dayOf(now()), start = end - horizon + 1; const per = {}; dated.forEach((it) => { const d = dayOf(it.posted_at); per[d] = (per[d] || 0) + 1; });
    const series = []; for (let d = start; d <= end; d++) series.push({ day: d * DAY, n: per[d] || 0 });
    const older = Object.entries(per).filter(([d]) => +d < start).reduce((a, [, n]) => a + n, 0);
    const bursts = [];
    for (let d = start; d <= end; d++) { const prev = []; for (let x = d - 7; x < d; x++) prev.push(per[x] || 0); const mu = mean(prev), sd = Math.sqrt(mean(prev.map((v) => (v - mu) ** 2))); const n = per[d] || 0; const z = (n - mu) / Math.max(sd, Math.sqrt(Math.max(mu, 1)));
      if (n >= 3 && z >= 2) { const last = bursts[bursts.length - 1]; if (last && last.endDay === d - 1) { last.endDay = d; last.end = d * DAY; last.n += n; last.z = Math.max(last.z, +z.toFixed(1)); } else bursts.push({ start: d * DAY, end: d * DAY, startDay: d, endDay: d, n, z: +z.toFixed(1) }); } }
    const sum = (a, b) => { let s = 0; for (let x = a; x <= b; x++) s += per[x] || 0; return s; };
    const last7 = sum(end - 6, end), prev7 = sum(end - 13, end - 7), last48h = sum(end - 1, end);
    const velocity = prev7 ? +(last7 / prev7).toFixed(2) : (last7 ? null : 0);
    const peakDay = +Object.keys(per).sort((a, b) => per[b] - per[a])[0];
    let state, why;
    if (!last7 && !prev7) { state = 'quiet'; why = 'nothing new in two weeks; peak was ' + per[peakDay] + ' posts in a day'; }
    else if (bursts.length && bursts[bursts.length - 1].endDay >= end - 1) { const b = bursts[bursts.length - 1]; state = 'surging'; why = b.n + ' posts in the last burst, ' + b.z + '× the usual spread above the week before'; }
    else if (prev7 && velocity >= 1.5) { state = 'rising'; why = last7 + ' posts this week vs ' + prev7 + ' last week'; }
    else if (prev7 && velocity <= 0.5) { state = 'fading'; why = last7 + ' posts this week vs ' + prev7 + ' last week'; }
    else if (!prev7 && last7) { state = 'new'; why = last7 + ' posts this week, none the week before'; }
    else { state = 'steady'; why = last7 + ' this week, ' + prev7 + ' last week'; }
    bursts.forEach((b) => { const ts = dated.filter((it) => dayOf(it.posted_at) >= b.startDay && dayOf(it.posted_at) <= b.endDay).map((it) => it.posted_at).sort((a, c) => a - c); b.takeoff = ts.length ? ts[Math.max(0, Math.floor(ts.length * 0.2) - 1)] : b.start; delete b.startDay; delete b.endDay; });   // take-off: a fifth of the burst's posts out
    return { series, older, last7, prev7, last48h, velocity, peak: { day: peakDay * DAY, n: per[peakDay] }, bursts: bursts.slice(-3), state, why, first: Math.min(...dated.map((i) => i.posted_at)), last: Math.max(...dated.map((i) => i.posted_at)) };
  }
  function sigSpread(items) {
    const first = {}, per = {}, accts = {}; const O = OUT();
    for (const it of items) { const p = it.platform || '?'; per[p] = (per[p] || 0) + 1; (accts[p] = accts[p] || new Set()).add(String(it.author || '').toLowerCase()); if (it.posted_at) first[p] = Math.min(first[p] || it.posted_at, it.posted_at); }
    REFERENCE.forEach((p) => delete first[p]);
    const order = Object.keys(first).sort((a, b) => first[a] - first[b]);
    const crossover = order.slice(1).map((p, i) => ({ from: order[i], to: p, hours: +((first[p] - first[order[i]]) / 3600).toFixed(1) }));
    const firsts = {}; items.filter((x) => x.posted_at).sort((a, b) => a.posted_at - b.posted_at).forEach((it) => { const a = String(it.author || '').toLowerCase(); if (firsts[a] === undefined) firsts[a] = it.posted_at; });
    const cut = now() - 7 * DAY; const newAccts = Object.values(firsts).filter((ts) => ts >= cut).length;
    const outlets = new Set(items.filter((it) => O.has(it.platform) && !REFERENCE.has(it.platform)).map((it) => String(it.author_name || it.author || '')));
    const byTime = items.filter((x) => x.posted_at).sort((a, b) => a.posted_at - b.posted_at);
    const firstOutlet = byTime.find((x) => O.has(x.platform) && !REFERENCE.has(x.platform)) || null, firstPost = byTime.find((x) => !O.has(x.platform)) || null;
    const why = []; if (order.length) why.push('started on ' + order[0] + (order.length > 1 ? ' and reached ' + order.slice(1, 3).join(', ') : ''));
    if (firstPost && firstOutlet) { const gap = (firstOutlet.posted_at - firstPost.posted_at) / 3600; why.push(gap > 0 ? 'news followed the posts by ' + Math.round(gap) + ' hours' : 'the posts followed the news by ' + Math.round(-gap) + ' hours'); }
    return { platforms: Object.entries(per).sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ platform: p, n, accounts: accts[p].size, first: first[p] })), accounts: new Set(Object.values(accts).flatMap((s) => [...s])).size, new_accounts_7d: newAccts, crossover, outlets: outlets.size, first_outlet: firstOutlet && ref(firstOutlet), first_post: firstPost && ref(firstPost), why: why.join('; ') };
  }
  function sigDrivers(items, burstStart, topN = 10) {
    const by = {}; const O = OUT();
    for (const it of items) if (it.author && !REFERENCE.has(it.platform)) { const k = String(it.author).toLowerCase() + '\u0001' + (it.platform || ''); (by[k] = by[k] || []).push(it); }
    const named = {}; for (const it of items) for (const m of ments(it.text)) if (m !== String(it.author || '').toLowerCase()) named[m] = (named[m] || 0) + 1;
    const ts0 = items.filter((i) => i.posted_at).map((i) => i.posted_at); const firstAll = ts0.length ? Math.min(...ts0) : 0, lastAll = ts0.length ? Math.max(...ts0) : 0;
    const earlyCut = burstStart || (firstAll + 0.1 * (lastAll - firstAll));
    const out = [];
    for (const k in by) { const its = by[k]; const [a, p] = k.split('\u0001');
      const reach = its.reduce((s, it) => s + (it.likes || 0) + 2 * (it.reposts || 0) + (it.replies || 0) + (it.views || 0) / 100, 0);
      const ts = its.filter((i) => i.posted_at).map((i) => i.posted_at); const early = ts.length > 0 && Math.min(...ts) <= earlyCut; const nm = named[a] || 0;
      const score = Math.log1p(reach) + 2 * Math.log1p(nm) + Math.log1p(its.length) + (early ? 2 : 0);
      const why = []; if (reach >= 50) why.push('reach ' + Math.round(reach).toLocaleString() + ' (likes, reposts, replies, views)'); if (nm) why.push('named by others ' + nm + '×'); if (early) why.push(burstStart ? 'posted before the burst' : 'among the first to post'); if (its.length >= 3) why.push(its.length + ' posts');
      const best = its.slice().sort((x, y) => ((y.likes || 0) + 2 * (y.reposts || 0)) - ((x.likes || 0) + 2 * (x.reposts || 0)))[0];
      out.push({ id: a + '|' + p, author: a, platform: p, role: O.has(p) ? 'outlet' : 'person', n: its.length, reach: Math.round(reach), named_by: nm, early, first: ts.length ? Math.min(...ts) : null, score: +score.toFixed(2), why, example: ref(best) }); }
    return out.sort((a, b) => b.score - a.score).slice(0, topN);
  }
  function sigHeat(items) {
    const n = Math.max(1, items.length); let hits = 0, shout = 0; const words = {}, examples = [], contested = [];
    for (const it of items) { const toks = tokens(it.text); const hw = toks.filter((w) => HEAT.has(w) || HEAT.has(stem(w)));
      if (hw.length) { hits++; new Set(hw).forEach((w) => words[w] = (words[w] || 0) + 1); if (examples.length < 6) examples.push(Object.assign(ref(it), { words: [...new Set(hw)].slice(0, 4) })); }
      if (shouting(it.text)) shout++;
      if ((it.likes || 0) >= 10 && it.replies != null) contested.push((it.replies || 0) / Math.max(1, it.likes || 0)); }
    const share = hits / n, ratio = contested.length ? median(contested) : null;
    const parts = [hits ? { kind: 'anger words', value: +share.toFixed(2), points: Math.round(Math.min(50, 50 * share / 0.35)), note: hits + ' of ' + n + ' posts use words like ' + top(words, 3).map(([w]) => w).join(', ') } : { kind: 'anger words', value: 0, points: 0, note: 'no anger words to speak of' },
      { kind: 'shouting', value: +(shout / n).toFixed(2), points: Math.round(Math.min(15, 15 * (shout / n) / 0.25)), note: shout + ' posts in caps or with !!!' }];
    if (ratio != null) parts.push({ kind: 'replies vs likes', value: +ratio.toFixed(2), points: Math.round(Math.min(25, 25 * ratio)), note: 'typical post gets ' + ratio.toFixed(1) + ' replies per like' + (ratio >= 0.5 ? ' (argued with more than agreed with)' : '') });
    const score = Math.min(100, parts.reduce((s, p) => s + p.points, 0));
    return { score, level: score >= 60 ? 'uproar' : score >= 35 ? 'hot' : score >= 15 ? 'warm' : 'calm', parts, words: top(words, 12).map(([word, c]) => ({ word, n: c })), examples };
  }
  function sigIssues(items) {
    const n = Math.max(1, items.length); const out = [];
    for (const cat in ISSUE_WORDS) { const ws = ISSUE_WORDS[cat]; let hit = 0; const words = {}, ex = [];
      for (const it of items) { const h = [...new Set(tokens(it.text))].filter((w) => ws.has(w)); if (h.length && !h.some((w) => ISSUE_STRONG.has(w)) && h.length < 2) continue; if (h.length) { hit++; h.forEach((w) => words[w] = (words[w] || 0) + 1); if (ex.length < 3) ex.push(ref(it)); } }
      if (hit >= Math.max(2, 0.03 * n)) out.push({ category: cat, n: hit, share: +(hit / n).toFixed(2), words: top(words, 5).map(([w]) => w), examples: ex }); }
    return out.sort((a, b) => b.n - a.n);
  }
  function sigStorylines(items, seedWords, maxLines = 5) {
    const skip = new Set([...(seedWords || []), ...STOP]);
    const docs = items.map((it) => [it, new Set(tokens(it.text).filter((w) => w.length > 3 && !skip.has(w) && !/^\d+$/.test(w)))]);
    const n = docs.length; if (n < 6) return [];
    const df = {}; docs.forEach(([, ws]) => ws.forEach((w) => df[w] = (df[w] || 0) + 1));
    let cand = new Set(Object.keys(df).filter((w) => df[w] >= 0.04 * n && df[w] <= 0.5 * n && df[w] >= 3));
    let left = docs.map((_, i) => i); const out = [];
    while (cand.size && left.length && out.length < maxLines) {
      const sub = {}; left.forEach((i) => docs[i][1].forEach((w) => { if (cand.has(w)) sub[w] = (sub[w] || 0) + 1; }));
      const best = top(sub, 1)[0]; if (!best || best[1] < Math.max(3, 0.04 * n)) break;
      const w0 = best[0]; const members = left.filter((i) => docs[i][1].has(w0));
      const co = {}; members.forEach((i) => docs[i][1].forEach((w) => { if (cand.has(w)) co[w] = (co[w] || 0) + 1; }));
      const ranked = Object.entries(co).filter(([, c]) => c >= 0.4 * members.length).map(([w, c]) => [(c * c / df[w]) * (w.length > 5 ? 1.2 : 1), w]).sort((a, b) => b[0] - a[0]);
      const terms = ranked.map(([, w]) => w).slice(0, 5); if (!terms.includes(w0)) terms.push(w0);
      const its = members.map((i) => docs[i][0]); const dated = its.filter((i) => i.posted_at).map((i) => i.posted_at); const accts = new Set(its.map((i) => String(i.author || '').toLowerCase()));
      const en = {}; its.forEach((it) => ents(it.text, seedWords).forEach((e) => en[e] = (en[e] || 0) + 1));
      out.push({ name: terms.slice(0, 3).join(' · '), terms, n: its.length, share: +(its.length / n).toFixed(2), accounts: accts.size, first: dated.length ? Math.min(...dated) : null, last: dated.length ? Math.max(...dated) : null, last7: dated.filter((ts) => ts >= now() - 7 * DAY).length, names: top(en, 4).map(([e]) => e),
        examples: its.slice().sort((a, b) => ((b.likes || 0) + (b.reposts || 0)) - ((a.likes || 0) + (a.reposts || 0))).slice(0, 3).map(ref) });
      const ms = new Set(members); left = left.filter((i) => !ms.has(i)); terms.forEach((w) => cand.delete(w));
    }
    return out;
  }
  function sigCoordination(items) {
    const groups = {}, links = {};
    for (const it of items) { const ws = normWords(it.text); if (ws.length >= 6) { const k = ws.slice(0, 14).join(' '); (groups[k] = groups[k] || []).push(it); }
      for (let u of String(it.text || '').match(/https?:\/\/\S+/g) || []) { u = u.replace(/[.,)]+$/, ''); if (u !== it.url) (links[u] = links[u] || []).push(it); } }
    const copies = []; for (const k in groups) { const its = groups[k]; const accts = new Set(its.map((i) => String(i.author || '').toLowerCase())); if (accts.size >= 3) { const ts = its.filter((i) => i.posted_at).map((i) => i.posted_at).sort((a, b) => a - b);
      copies.push({ text: String(its[0].text || '').slice(0, 160), n: its.length, accounts: accts.size, platforms: [...new Set(its.map((i) => i.platform || ''))].sort(), within_hours: ts.length > 1 ? +((ts[ts.length - 1] - ts[0]) / 3600).toFixed(1) : null, examples: its.slice(0, 3).map(ref) }); } }
    copies.sort((a, b) => (b.accounts - a.accounts) || ((a.within_hours ?? 1e9) - (b.within_hours ?? 1e9)));
    const same = []; for (const u in links) { const its = links[u]; const accts = new Set(its.map((i) => String(i.author || '').toLowerCase())); if (accts.size >= 3) same.push({ url: u, n: its.length, accounts: accts.size, examples: its.slice(0, 3).map(ref) }); }
    same.sort((a, b) => b.accounts - a.accounts);
    const c = copies[0]; const note = c ? c.accounts + ' accounts posted the same words' + (c.within_hours != null ? ' within ' + c.within_hours + ' hours' : '') + '. Could be a campaign, a share button, or a quote. Read them.' : '';
    return { copies: copies.slice(0, 6), same_link: same.slice(0, 6), note };
  }
  function sigLeadLag(items, burst) {
    if (!burst) return []; const t0 = burst.takeoff || burst.start; const O = OUT(); const who = (it) => (O.has(it.platform) ? 'outlet ' + (it.author_name || it.author || '') : '@' + (it.author || ''));
    const firsts = {}; for (const it of items.filter((x) => x.posted_at).sort((a, b) => a.posted_at - b.posted_at)) { const a = who(it); if (!firsts[a]) firsts[a] = [it.posted_at, it]; for (const e of ents(it.text)) if (!firsts['name ' + e]) firsts['name ' + e] = [it.posted_at, it]; }
    const after = {}; for (const it of items) if ((it.posted_at || 0) >= t0) { const a = who(it); after[a] = (after[a] || 0) + 1; for (const e of ents(it.text)) after['name ' + e] = (after['name ' + e] || 0) + 1; }
    return Object.entries(firsts).filter(([k, [ts]]) => t0 - ts >= 0 && t0 - ts <= 2 * DAY && ((after[k] || 0) >= 3 || t0 - ts >= 2 * 3600)).map(([k, [ts, it]]) => ({ what: k, first: ts, hours_before: +((t0 - ts) / 3600).toFixed(1), after: after[k] || 0, example: ref(it) })).sort((a, b) => b.after - a.after).slice(0, 8);
  }
  const PLACE_HINT = /\b(?:in|at|near|outside|across|around)\s+([A-Z][\w'’.-]*(?:\s+(?:of\s+)?[A-Z][\w'’.-]*){0,3})/g;
  const PLACE_WORD = /\b(county|city|beach|island|park|street|avenue|river|lake|bay|valley|village|town|township|parish|district|downtown|harbor|harbour|heights|springs|falls|hills|coast|fla|calif|tex|ala|ga|n\.?c|s\.?c|va|pa|ny|nj|ohio|texas|florida|california|georgia|alabama|carolina|virginia|london|paris|tokyo)\b/i;
  const NOT_PLACE = new Set('the a an my our this that least first last all monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december'.split(' '));
  function sigPlaces(items, seedWords) {
    const c = {}, ex = {}; const seeds = new Set(seedWords || []);
    for (const it of items) { if (it.dateline) { c[it.dateline] = (c[it.dateline] || 0) + 2; ex[it.dateline] = ex[it.dateline] || ref(it); }
      const seen = new Set(); for (const m of String(it.text || '').matchAll(PLACE_HINT)) { const name = m[1].replace(/^[ .]+|[ .]+$/g, ''); const low = name.toLowerCase(); if (name.length < 3 || seen.has(low) || low.split(' ').every((w) => seeds.has(w) || STOP.has(w)) || NOT_PLACE.has(low.split(' ')[0])) continue; seen.add(low); c[name] = (c[name] || 0) + (PLACE_WORD.test(name) ? 2 : 1); ex[name] = ex[name] || ref(it); } }
    const out = []; for (const [name, n] of top(c, 40)) { if (out.some((o) => name !== o.place && o.place.toLowerCase().includes(name.toLowerCase()))) continue; if (n >= 2) out.push({ place: name, n, example: ex[name] }); }
    return out.slice(0, 10);
  }
  const reachOf = (it) => (it.likes || 0) + 2 * (it.reposts || 0) + (it.replies || 0) + (it.views || 0) / 100;
  function sigTopPosts(items, k = 3) { const out = [], seen = new Set(); for (const it of items.slice().sort((a, b) => reachOf(b) - reachOf(a))) { const a = String(it.author || '').toLowerCase(); if (seen.has(a) || reachOf(it) <= 0) continue; seen.add(a); out.push(Object.assign(ref(it), { reach: Math.round(reachOf(it)) })); if (out.length >= k) break; } return out; }
  function sigMomentum(tr, sp, st) {
    const parts = []; let score = 0;
    if (tr.state === 'surging' || tr.state === 'rising') { parts.push('growing: ' + tr.why); score += 2; } else if (tr.state === 'fading' || tr.state === 'quiet') { parts.push(tr.state + ': ' + tr.why); score -= 2; } else if (tr.state === 'new') { parts.push('new this week'); score += 1; } else parts.push('steady');
    if (sp.new_accounts_7d) { parts.push(sp.new_accounts_7d + ' new voices this week'); score += 1; }
    const fresh = st.filter((x) => x.last7 && x.last7 >= Math.max(2, 0.5 * x.n)), dying = st.filter((x) => x.n >= 4 && !x.last7);
    if (fresh.length) { parts.push('new storyline' + (fresh.length > 1 ? 's' : '') + ': ' + fresh.slice(0, 2).map((x) => x.name).join(', ')); score += 1; }
    if (dying.length) { parts.push('gone quiet: ' + dying.slice(0, 2).map((x) => x.name).join(', ')); score -= 1; }
    if (sp.outlets) parts.push(sp.outlets + ' outlet' + (sp.outlets !== 1 ? 's' : '') + ' on it'); else if (sp.accounts >= 10) parts.push('no outlet has picked it up yet');
    return { label: score >= 2 ? 'picking up' : score >= -1 ? 'holding' : 'winding down', score, why: parts.join('; ') };
  }
  const sigArc = (tr) => tr.first ? { born: tr.first, peak: tr.peak, last: tr.last, state: tr.state, age_days: Math.max(0, Math.floor((now() - tr.first) / DAY)), silent_days: Math.max(0, Math.floor((now() - tr.last) / DAY)) } : null;
  function sigOrigin(items, sp, burst) {
    const o = { first_post: sp.first_post, first_outlet: sp.first_outlet, news_led: null, kickoff: null }; const O = OUT();
    if (sp.first_post && sp.first_outlet && sp.first_post.posted_at && sp.first_outlet.posted_at) o.news_led = sp.first_outlet.posted_at <= sp.first_post.posted_at;
    if (burst) { const t0 = burst.takeoff || burst.start; const before = items.filter((it) => it.posted_at && t0 - 2 * DAY <= it.posted_at && it.posted_at <= t0);
      if (before.length) { const best = before.reduce((a, b) => ((b.likes || 0) + 2 * (b.reposts || 0) + (O.has(b.platform) ? 1000 : 0)) > ((a.likes || 0) + 2 * (a.reposts || 0) + (O.has(a.platform) ? 1000 : 0)) ? b : a); o.kickoff = Object.assign(ref(best), { hours_before: +((t0 - best.posted_at) / 3600).toFixed(1) }); } }
    return o;
  }

  // ── claims, numbers that move, dated events, trust (mirrors server/rv/signals.py) ──
  const SENT_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"“])|\n+/;
  const ASSERT = /\b(said|says|saying|confirmed|confirms|announced|announces|reports|reported|claims|claimed|denied|denies|admitted|admits|according to|told|stated|warned|warns|estimates|estimated|expects|expected|will|has|have|is|are|was|were)\b/i;
  const DISPUTE = /\b(false|not true|untrue|debunked|denies|denied|deny|misinformation|hoax|fake|no evidence|incorrect|wrong|rumor|rumour)\b/i;
  const NUM = /(?<![\w.])([$£€])?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(k|m|bn|b|million|billion|thousand|%|percent|mph|km\/h|inches|feet|ft|miles|acres|degrees)\b)?(?:\s+(?:of\s+|a\s+|an\s+|per\s+)?([a-z][a-z-]{2,}))?/gi;
  const NUM_SKIP = new Set('am pm the and for with that this from year years day days hour hours minute minutes week weeks month months time times ago today yesterday tomorrow more than about'.split(' '));
  const UNITS = new Set(['%', 'percent', 'mph', 'km/h', 'inches', 'feet', 'ft', 'miles', 'acres', 'degrees']);
  const UNIT_WORDS = new Set(['%', 'percent', 'mph', 'km/h', 'inches', 'feet', 'ft', 'miles', 'acres', 'degrees', 'million', 'billion', 'thousand', 'k', 'm', 'bn', 'b']);
  const QTY_WORDS = new Set('people customers residents homes households families deaths dead killed injured missing cases patients students workers jobs employees evacuees acres buildings structures cars vehicles units tickets attendees followers members votes voters troops soldiers protesters officers arrests shelters outages complaints calls reports crews trucks flights schools businesses inches feet miles percent dollars hours days weeks months years minutes'.split(' '));
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const WEEKDAYS = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
  const DATE_RX = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?|(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?|(next|last|this)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(tonight|tomorrow|yesterday)\b)/gi;
  const PAST_HINT = /\b(was|were|happened|took place|yesterday|last|ago|had|did|\w{3,}ed)\b/i;
  const sentencesOf = (t) => String(t || '').split(SENT_SPLIT).map((x) => x.trim()).filter((x) => x.length >= 30 && x.length <= 300 && !/^(http|rt @)/i.test(x));
  const claimKey = (s) => new Set(tokens(s).filter((w) => !STOP.has(w) && w.length > 2).map(stem));
  const jac = (a, b) => { let i = 0; a.forEach((x) => { if (b.has(x)) i++; }); return i / Math.max(1, a.size + b.size - i); };
  const whoOf = (it) => (OUT().has(it.platform) ? (it.author_name || it.author) : it.author);
  function sigClaims(items, seedWords, topN = 10) {
    const out = [];
    for (const it of items.filter((x) => x.posted_at).sort((a, b) => a.posted_at - b.posted_at)) for (const s of sentencesOf(it.text)) {
      if (!ASSERT.test(s) || !/\d|\b[A-Z][a-z]+\b/.test(s)) continue;
      const key = claimKey(s); if (key.size < 4) continue; const who = whoOf(it); const isOut = OUT().has(it.platform);
      const hit = out.find((c) => { const j = jac(key, c.key); return j >= 0.45 || (j >= 0.25 && DISPUTE.test(s) && !DISPUTE.test(c.text)); });
      if (!hit) { out.push({ key, text: s, first: { who, platform: it.platform, posted_at: it.posted_at, url: it.url, id: it.id }, accounts: new Set([String(it.author || '').toLowerCase()]), n: 1, outlets: new Set(isOut && who ? [who] : []), disputed: [], examples: [ref(it)] }); }
      else { hit.n++; hit.accounts.add(String(it.author || '').toLowerCase()); if (isOut && who) hit.outlets.add(who); if (DISPUTE.test(s) && !DISPUTE.test(hit.text) && hit.disputed.length < 3) hit.disputed.push(Object.assign(ref(it), { who })); if (hit.examples.length < 3) hit.examples.push(ref(it)); }
    }
    return out.filter((c) => c.accounts.size >= 2).map((c) => ({ text: c.text, first: c.first, n: c.n, accounts: c.accounts.size, outlets: [...c.outlets].sort(), status: c.disputed.length ? 'disputed' : c.outlets.size ? 'an outlet confirms' : 'posts only', disputed: c.disputed, examples: c.examples }))
      .sort((a, b) => ((b.accounts + 2 * b.outlets.length) - (a.accounts + 2 * a.outlets.length)) || (a.first.posted_at - b.first.posted_at)).slice(0, topN);
  }
  const numVal = (v, u) => { v = parseFloat(String(v).replace(/,/g, '')); u = (u || '').toLowerCase(); return u === 'k' || u === 'thousand' ? v * 1e3 : u === 'm' || u === 'million' ? v * 1e6 : u === 'b' || u === 'bn' || u === 'billion' ? v * 1e9 : v; };
  function sigNumbers(items, topN = 8) {
    const series = {};
    for (const it of items) { if (!it.posted_at) continue; for (const m of String(it.text || '').matchAll(NUM)) { const [raw, cur, val, unit, whatRaw] = m; const what = (whatRaw || '').toLowerCase(); const u = (unit || '').toLowerCase();
      if ((what && NUM_SKIP.has(what)) || (!unit && !cur && (!what || val.length < 2)) || (/^\d{4}$/.test(val) && !unit && !cur) || (['k', 'm', 'b', 'bn'].includes(u) && !what)) continue;
      if (!cur && !(unit && UNIT_WORDS.has(u)) && !QTY_WORDS.has(what)) continue;   // "11 Boston", "02 unknown": a track number, not a figure
      const key = ((cur || '') + (UNITS.has(u) ? ' ' + u : '') + (what ? ' ' + what : '')).trim(); if (!key || key === '%' || key === 'percent') continue;
      (series[key] = series[key] || []).push({ ts: it.posted_at, value: numVal(val, unit), raw: raw.trim(), post: ref(it) }); } }
    const out = []; for (const key in series) { const pts = series[key].sort((a, b) => a.ts - b.ts); const vals = new Set(pts.map((p) => p.value)); if (pts.length < 2 || (vals.size < 2 && pts.length < 3)) continue;
      out.push({ what: key, n: pts.length, first: pts[0].value, last: pts[pts.length - 1].value, min: Math.min(...vals), max: Math.max(...vals), moved: vals.size > 1, points: pts.slice(-12) }); }
    return out.sort((a, b) => ((b.moved ? 1 : 0) - (a.moved ? 1 : 0)) || (b.n - a.n)).slice(0, topN);
  }
  function resolveDate(m, ts) {
    const base = new Date(ts * 1000); const day0 = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
    if (m[1] || m[5]) { const mon = MONTHS[(m[1] || m[5]).toLowerCase().slice(0, 3)]; const day = +(m[2] || m[4]); const yr = +(m[3] || m[6] || base.getUTCFullYear()); let d = new Date(Date.UTC(yr, mon - 1, day)); if (isNaN(d)) return null;
      if (!(m[3] || m[6])) { const diff = (d - base) / 864e5; if (diff > 240) d = new Date(Date.UTC(yr - 1, mon - 1, day)); else if (diff < -240) d = new Date(Date.UTC(yr + 1, mon - 1, day)); } return [Math.floor(d / 1000), 'day']; }
    if (m[8]) { const wd = WEEKDAYS[m[8].toLowerCase()]; const bw = (base.getUTCDay() + 6) % 7; let delta = (wd - bw + 7) % 7; const q = (m[7] || '').toLowerCase(); if (q === 'last') delta = delta ? delta - 7 : -7; else if (q === 'next' && delta === 0) delta = 7; return [day0(base) + delta * DAY, 'weekday']; }
    const w = (m[9] || '').toLowerCase(); if (w === 'tonight') return [day0(base), 'day']; if (w === 'tomorrow') return [day0(base) + DAY, 'day']; if (w === 'yesterday') return [day0(base) - DAY, 'day'];
    return null;
  }
  function sigDated(items, topN = 12) {
    const ev = [];
    for (const it of items) { if (!it.posted_at) continue; for (const s of sentencesOf(it.text)) { for (const m of s.matchAll(DATE_RX)) { const r = resolveDate(m, it.posted_at); if (!r) continue; let [when, kind] = r;
      if (kind === 'weekday' && !(m[7] || '') && PAST_HINT.test(s) && when > it.posted_at) when -= 7 * DAY;
      const key = claimKey(s); const hit = ev.find((e) => Math.abs(e.when - when) < DAY && jac(key, e.key) >= 0.4);
      if (hit) { hit.n++; if (hit.examples.length < 3) hit.examples.push(ref(it)); } else ev.push({ key, when, text: s, date_text: m[0].trim(), n: 1, examples: [ref(it)], who: whoOf(it), platform: it.platform });
      break; } } }
    const t = now(); ev.forEach((e) => { delete e.key; e.ahead = e.when > t; });
    const ahead = ev.filter((e) => e.ahead).sort((a, b) => (a.when - b.when) || (b.n - a.n)).slice(0, topN);
    const past = ev.filter((e) => !e.ahead).sort((a, b) => (b.n - a.n) || (b.when - a.when)).slice(0, topN).sort((a, b) => a.when - b.when);
    return { ahead, past };
  }
  function sigTrust(items, tr, sp, sources, windowDays, older, rated) {
    const n = items.length; const reasons = []; let score = 0;
    const unrated = rated != null && n >= 10 && rated < Math.max(5, 0.05 * n); if (unrated) reasons.push('only ' + rated + ' of ' + n + ' posts rated: what is in the topic is a guess');
    if (n >= 60) { score += 2; reasons.push(n + ' posts'); } else if (n >= 20) { score += 1; reasons.push(n + ' posts'); } else { score -= 1; reasons.push('only ' + n + ' posts'); }
    const plats = (sp.platforms || []).length; if (plats >= 3) { score += 1; reasons.push(plats + ' networks'); } else if (plats <= 1) { score -= 1; reasons.push('one network only'); }
    const srcs = sources || []; const failed = srcs.filter((s) => !s.enabled && s.auto_off);
    if (srcs.length && failed.length >= Math.max(1, Math.floor(srcs.length / 2))) { score -= 1; reasons.push(failed.length + ' of ' + srcs.length + ' sources switched off after failing'); } else if (failed.length) reasons.push(failed.length + ' source' + (failed.length > 1 ? 's' : '') + ' switched off: ' + failed.slice(0, 2).map((s) => s.name || '?').join(', '));
    const series = tr.series || []; if (series.length) { const empty = series.filter((d) => !d.n).length; if (empty >= 0.8 * series.length && tr.state !== 'quiet') { score -= 1; reasons.push(empty + ' of the last ' + series.length + ' days have no posts'); } }
    if (windowDays && older) reasons.push('the ' + windowDays + '-day window left ' + older + ' older posts out');
    if (sp.outlets) score += 1;
    return { label: unrated ? 'thin' : score >= 3 ? 'solid' : score >= 1 ? 'fair' : 'thin', score, reasons };   // unverified membership caps the read at thin
  }
  function summarizeSignals(items, seedWords) {
    const tr = sigTrend(items); const burst = tr.bursts.length ? tr.bursts[tr.bursts.length - 1] : null;
    const sp = sigSpread(items), ht = sigHeat(items), st = sigStorylines(items, seedWords), co = sigCoordination(items), dr = sigDrivers(items, burst ? (burst.takeoff || burst.start) : null), iss = sigIssues(items);
    const headline = [];
    if (tr.state === 'surging' || tr.state === 'rising') headline.push(tr.state + ' (' + tr.why + ')'); else if (tr.state === 'fading' || tr.state === 'quiet') headline.push(tr.state);
    if (ht.level === 'hot' || ht.level === 'uproar') headline.push(ht.level + ': ' + ht.words.slice(0, 3).map((w) => w.word).join(', '));
    if (iss.length) headline.push('reads as ' + iss[0].category + (iss[1] ? ' and ' + iss[1].category : ''));
    if (co.copies.length && co.copies[0].accounts >= 5) headline.push(co.copies[0].accounts + ' accounts posting the same words');
    return { n: items.length, trend: tr, spread: sp, drivers: dr, heat: ht, issues: iss, storylines: st, coordination: co, lead_lag: sigLeadLag(items, burst), headline: headline.join('; ') || 'nothing out of the ordinary', places: sigPlaces(items, seedWords), top_posts: sigTopPosts(items), momentum: sigMomentum(tr, sp, st), arc: sigArc(tr), origin: sigOrigin(items, sp, burst), claims: sigClaims(items, seedWords), numbers: sigNumbers(items), dated: sigDated(items), trust: sigTrust(items, tr, sp), badge: { state: tr.state, heat: ht.level, score: ht.score, velocity: tr.velocity }, generated: now() };
  }
  async function signals(tid) {
    const t = await getTopic(tid); if (!t) return { error: 'no such topic' };
    const votes = await topicItems(tid); const tau = threshold(votes); const ids = votes.filter((v) => isMember(v, tau)).map((v) => v.item_id).slice(0, 3000);
    const items = (await Promise.all(ids.map((id) => idb.get('items', id)))).filter(Boolean);
    const seedWords = new Set((t.seeds || []).concat([t.name || '']).flatMap((s) => tokens(s)));
    const out = summarizeSignals(items, seedWords);
    // topics in the library this one overlaps with (shared member posts)
    const idset = new Set(ids); const ov = {}; for (const v of await idb.all('votes')) if (v.topic_id !== tid && v.label >= 0 && idset.has(v.item_id)) ov[v.topic_id] = (ov[v.topic_id] || 0) + 1;
    const tops = {}; (await idb.all('topics')).forEach((x) => tops[x.id] = x.name);
    out.overlaps = top(ov, 6).filter(([k, n]) => n >= 2 && tops[k]).map(([k, n]) => ({ topic_id: k, name: tops[k], n }));
    out.kind = ((t.settings || {}).plan || {}).kind || 'general';
    try { const all = (await L.request('/api/sources')).sources || []; const mine = new Set(t.sources || []); out.trust = sigTrust(items, out.trend, out.spread, all.filter((s) => mine.has(s.id)), windowDays(t.settings, (t.settings || {}).plan), out.trend.older || 0, votes.filter((v) => v.label).length); } catch (e) { /* keep the plain trust */ }
    return out;
  }
  L.signals = { summarize: summarizeSignals, trend: sigTrend, heat: sigHeat, storylines: sigStorylines, coordination: sigCoordination, claims: sigClaims, numbers: sigNumbers, dated: sigDated };

  async function brief(tid) {
    const t = await getTopic(tid); if (!t) return { error: 'no such topic' };
    const sc = await scorer(t); const votes = await topicItems(tid); const tau = threshold(votes);
    const rows = votes.filter((v) => isMember(v, tau)).sort((a, b) => (b.label - a.label) || (b.score - a.score)).slice(0, 400);
    const weights = {}; (t.seeds || []).forEach((s) => tokens(s).forEach((w) => weights[stem(w)] = (weights[stem(w)] || 0) + 3));
    if (sc.pc) Object.entries(sc.pc).filter(([k]) => k[0] === 'w').sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => weights[k.slice(2)] = (weights[k.slice(2)] || 0) + 1.5 * Math.max(0.1, v));
    const items = {}; rows.forEach((v) => { const it = sc.itemsById[v.item_id]; if (it) items[v.item_id] = it; });
    const cands = [];
    rows.forEach((v, i) => { const it = items[v.item_id]; if (!it) return; let best = null;
      for (const s of String(it.text || '').split(/(?<=[.!?])\s+(?=[A-Z0-9"“])|\n+/)) { const z = s.trim(); if (z.length < 40 || z.length > 320 || /^(http|rt @)/i.test(z)) continue; const toks = new Set(tokens(z).map(stem)); let w = 0; toks.forEach((x) => w += weights[x] || 0); w /= 1 + 0.02 * toks.size; if (v.label > 0) w *= 1.5; if (!best || w > best[0]) best = [w, z]; }
      if (best && best[0] > 0) cands.push([best[0], i + 1, best[1], it]); });
    cands.sort((a, b) => b[0] - a[0]);
    const out = [], seen = [];
    for (const [, n, s, it] of cands) { const key = new Set(tokens(s)); if (seen.some((k) => { let inter = 0; key.forEach((x) => { if (k.has(x)) inter++; }); return inter / Math.max(1, new Set([...key, ...k]).size) > 0.6; })) continue; seen.push(key); out.push({ n, text: s, item_id: it.id, url: it.url, author: it.author, platform: it.platform, when: it.posted_at }); if (out.length >= 10) break; }
    const count = (f) => { const c = {}; Object.values(items).forEach((it) => (f(it) || []).forEach((k) => { if (k) c[k] = (c[k] || 0) + 1; })); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
    const plats = count((it) => [it.platform || '?']).slice(0, 8), tags = count((it) => (it.hashtags || '').toLowerCase().split(/\s+/)).slice(0, 12);
    const accounts = count((it) => [(it.author || '?') + '|' + (it.platform || '')]).slice(0, 8).map(([k, n]) => ({ author: k.split('|')[0], platform: k.split('|')[1], n }));
    const dates = Object.values(items).map((it) => it.posted_at).filter(Boolean).sort((a, b) => a - b);
    const weeks = {}, heads = {}; Object.values(items).forEach((it) => { if (!it.posted_at) return; const wk = Math.floor(it.posted_at / 604800); weeks[wk] = (weeks[wk] || 0) + 1; if (!heads[wk] || String(it.text || '').length > String(heads[wk].text || '').length) heads[wk] = it; });
    const timeline = Object.keys(weeks).map(Number).sort((a, b) => a - b).slice(-16).map((wk) => ({ week_start: wk * 604800, n: weeks[wk], headline: String(heads[wk].text || '').slice(0, 140).split('\n')[0], url: heads[wk].url }));
    const citations = {}; rows.forEach((v, i) => { const it = items[v.item_id]; if (it) citations[i + 1] = { url: it.url, author: it.author, platform: it.platform, when: it.posted_at, text: String(it.text || '').slice(0, 400) }; });
    const head = `You are summarising a research topic named "${t.name}" (searches: ${(t.seeds || []).join(', ')}).\nBelow are numbered posts and articles collected for it. Write a brief for someone who has not read them:\n1) a 3-sentence summary, 2) key facts as bullets, 3) who is involved and where, 4) a short timeline, 5) open questions or contradictions. Cite posts as [n] after every claim. Use only what is in the posts; say when something is unclear. Plain language, no hype.\n\nPOSTS:\n`;
    let prompt = head; for (const n of Object.keys(citations).map(Number).sort((a, b) => a - b)) { const c = citations[n]; const line = `[${n}] (${c.platform} · @${c.author}) ${c.text.trim()}\n`; if (prompt.length + line.length > 24000) break; prompt += line; }
    return { topic: t.name, n_items: Object.keys(items).length, n_liked: rows.filter((v) => v.label > 0).length, first: dates[0] || null, last: dates[dates.length - 1] || null, sentences: out, platforms: plats, accounts, tags, timeline, citations, prompt };
  }
  const WORKER_ACCOUNT = new Set(['mastodon', 'bluesky', 'reddit', 'youtube', 'lemmy']);
  const ARTICLE_PLATFORMS = new Set(['news', 'web', 'hackernews', 'archive']);
  function creator(t, body) {
    let handle = String(body.handle || body.author || '').trim(), platform = String(body.platform || '').toLowerCase();
    const m = handle.match(/^https?:\/\/(?:www\.)?([^/]+)\/(?:profile\/|user\/|@)?([^/?#]+)/i);
    if (m) { const dom = m[1]; handle = m[2]; platform = /bsky/.test(dom) ? 'bluesky' : /youtu/.test(dom) ? 'youtube' : /reddit/.test(dom) ? 'reddit' : /x\.com|twitter/.test(dom) ? 'x' : /instagram/.test(dom) ? 'instagram' : /tiktok/.test(dom) ? 'tiktok' : 'mastodon'; if (platform === 'mastodon' && !handle.includes('@')) handle += '@' + dom; }
    handle = handle.replace(/^@/, '');
    if (!handle) return { error: 'enter a username or profile link' };
    if (!platform) platform = handle.includes('@') ? 'mastodon' : /\.bsky\.social$|\./.test(handle) ? 'bluesky' : 'x';
    if (!WORKER_ACCOUNT.has(platform)) return { error: platform + ' needs a login to read a profile. Run the PC server (SETUP → cookies) for ' + platform + ' accounts. Mastodon, Bluesky, Reddit and YouTube work from the browser.' };
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
    if (!(await L.hub())) return [];
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
