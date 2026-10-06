/* ─────────────────────────────────────────────────────────────────
 *  SearchNet — account profiles & the connection web (spiderweb).
 *
 *  PURPOSE: find related content. For every account whose PUBLIC posts
 *  you've already collected, this summarises WHAT they post (topics,
 *  hashtags, media, cadence) and how accounts connect to each other
 *  through SHARED CONTENT — so you can hop from one creator to related
 *  ones. More shared signal = a stronger link in the web.
 *
 *  ETHICS (enforced here, by design):
 *   • Only accounts YOU collected, only from their own public posts.
 *   • It never guesses sensitive traits (sexuality, politics, religion,
 *     health, ethnicity, real identity). Any such label is one YOU type
 *     in, kept on your device, and shown as your own note — never inferred.
 *   • No cross-platform de-anonymisation. Each account is profiled on its
 *     own; "same person" is only ever a link you add by hand.
 *   • Everything stays on this device. Nothing is published or tracked.
 *
 *  Attaches to window.SearchNetLocal as .people.
 * ───────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  const L = window.SearchNetLocal;
  if (!L) return;
  const idb = L.idb;
  const now = () => Math.floor(Date.now() / 1000);
  const STOP = new Set('a an and are as at be but by for from has have he her his i in into is it its just me my no not of on or our so that the their them then there these they this to too up us was we were what when which who will with you your rt via amp http https www com de la el en que un the and for'.split(' '));
  const stem = (w) => w.replace(/(ings?|edly|ed|es|s|ly)$/, '') || w;
  const tokens = (t) => (String(t || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[\p{L}\p{N}]+/gu) || []);
  const mentionsIn = (t) => [...new Set((String(t || '').match(/(?:^|[^\w@])@([a-z0-9_.]{2,})/gi) || []).map((m) => m.replace(/.*@/, '').toLowerCase().replace(/[.]+$/, '')))];
  const hashSet = (it) => { const h = new Set((it.hashtags || '').toLowerCase().split(/\s+/).filter(Boolean)); if (!h.size) (String(it.text || '').match(/(?:^|\s)#([\p{L}\p{N}_]{2,})/gu) || []).forEach((m) => h.add(m.replace(/.*#/, '').toLowerCase())); return h; };
  const pid = (it) => (it.author || '?') + '|' + (it.platform || '?');
  const median = (xs) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

  // ── user-added meta (notes / your own labels / hand links), kept local ──
  async function allMeta() { const row = await idb.get('kv', 'people_meta'); return (row && row.v) || {}; }
  async function getMeta(id) { return (await allMeta())[id] || { notes: '', attrs: [], links: [] }; }
  async function setMeta(id, patch) {
    const all = await allMeta(); const m = Object.assign({ notes: '', attrs: [], links: [] }, all[id] || {});
    if ('notes' in patch) m.notes = String(patch.notes || '').slice(0, 4000);
    if ('attrs' in patch) m.attrs = [...new Set((patch.attrs || []).map((a) => String(a).trim()).filter(Boolean))].slice(0, 40);
    if ('links' in patch) m.links = [...new Set((patch.links || []).map(String).filter(Boolean))].slice(0, 40);
    all[id] = m; await idb.put('kv', { k: 'people_meta', v: all }); return m;
  }

  // ── build per-account aggregates from collected items ──
  async function build() {
    const items = await idb.all('items');
    const by = new Map();                      // id -> {author, platform, author_url, author_name, items:[]}
    for (const it of items) {
      if (!it.author) continue;
      const id = pid(it);
      let a = by.get(id);
      if (!a) by.set(id, a = { id, author: it.author, platform: it.platform, author_url: it.author_url || '', author_name: it.author_name || '', items: [] });
      a.items.push(it);
      if (!a.author_url && it.author_url) a.author_url = it.author_url;
      if (!a.author_name && it.author_name) a.author_name = it.author_name;
    }
    // document frequency across accounts for rarity weighting
    const hDF = {}, wDF = {};
    for (const a of by.values()) {
      const H = new Set(), Wd = new Set();
      a.items.forEach((it) => { hashSet(it).forEach((h) => H.add(h)); new Set(tokens(it.text).filter((w) => w.length > 3 && !STOP.has(w))).forEach((w) => Wd.add(w)); });
      H.forEach((h) => hDF[h] = (hDF[h] || 0) + 1); Wd.forEach((w) => wDF[w] = (wDF[w] || 0) + 1);
      a._H = H; a._W = Wd;
      a._mentions = new Set(); a.items.forEach((it) => mentionsIn(it.text).forEach((m) => a._mentions.add(m)));
    }
    const N = by.size || 1;
    const idf = (df) => Math.log((N + 1) / ((df || 0) + 1)) + 1;
    return { by, N, hDF, wDF, idf };
  }

  // votes → which topics an account's items sit in
  async function voteIndex() {
    const votes = await idb.all('votes'); const byItem = new Map();
    votes.forEach((v) => { (byItem.get(v.item_id) || byItem.set(v.item_id, []).get(v.item_id)).push(v); });
    const topics = {}; (await idb.all('topics')).forEach((t) => topics[t.id] = t.name);
    return { byItem, topics };
  }

  function cadence(items) {
    const hours = Array(24).fill(0), weekdays = Array(7).fill(0); let lo = Infinity, hi = 0;
    items.forEach((it) => { const ts = it.posted_at; if (!ts) return; const d = new Date(ts * 1000); hours[d.getUTCHours()]++; weekdays[d.getUTCDay()]++; lo = Math.min(lo, ts); hi = Math.max(hi, ts); });
    const span = isFinite(lo) ? Math.max(1, (hi - lo) / 86400) : 0;
    return { hours, weekdays, first: isFinite(lo) ? lo : null, last: hi || null, span_days: Math.round(span), per_week: span ? +(items.filter((i) => i.posted_at).length / (span / 7)).toFixed(1) : 0 };
  }
  function topCount(items, pick, n = 12) { const c = {}; items.forEach((it) => pick(it).forEach((v) => v && (c[v] = (c[v] || 0) + 1))); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count })); }

  // ── a single account's profile ──
  async function profile(id) {
    const { by, idf, hDF, wDF } = await build();
    const a = by.get(id); if (!a) return { error: 'no account' };
    const { byItem, topics } = await voteIndex();
    const items = a.items;
    const cad = cadence(items);
    const media = {}; items.forEach((it) => { const m = it.media || 'video'; media[m] = (media[m] || 0) + 1; });
    const durs = items.filter((it) => it.duration > 0).map((it) => it.duration);
    const words = topCount(items, (it) => tokens(it.text).filter((w) => w.length > 3 && !STOP.has(w))).map((x) => Object.assign(x, { w: +(x.count * idf(wDF[x.value])).toFixed(1) })).sort((a, b) => b.w - a.w).slice(0, 12);
    // topic membership from votes
    const tstat = {};
    items.forEach((it) => (byItem.get(it.id) || []).forEach((v) => { const s = tstat[v.topic_id] || (tstat[v.topic_id] = { topic_id: v.topic_id, name: topics[v.topic_id] || '?', matched: 0, liked: 0, disliked: 0, score: 0 }); s.matched++; if (v.label > 0) s.liked++; else if (v.label < 0) s.disliked++; s.score += v.score || 0; }));
    const topicRows = Object.values(tstat).map((s) => ({ ...s, score: +(s.score / s.matched).toFixed(3) })).sort((a, b) => b.matched - a.matched);
    // connections (this account vs others)
    const edges = edgesFor(a, by, idf, hDF, wDF).slice(0, 12);
    const recent = items.filter((it) => it.media_url || it.thumbnail || it.url).sort((x, y) => (y.posted_at || 0) - (x.posted_at || 0)).slice(0, 8)
      .map((it) => ({ id: it.id, text: (it.text || '').slice(0, 160), media: it.media, thumbnail: it.thumbnail, url: it.url, posted_at: it.posted_at, likes: it.likes }));
    const mentions = {}; items.forEach((it) => mentionsIn(it.text).forEach((m) => { if (m !== a.author.toLowerCase()) mentions[m] = (mentions[m] || 0) + 1; }));
    return {
      id, author: a.author, author_name: a.author_name, platform: a.platform, author_url: a.author_url,
      n: items.length, ...cad, media, dur_median: median(durs), likes_median: median(items.map((i) => i.likes || 0)), views_median: median(items.map((i) => i.views || 0)),
      langs: topCount(items, (it) => it.lang ? [it.lang] : [], 6), hashtags: topCount(items, (it) => [...hashSet(it)]), words,
      topics: topicRows, connected: edges,
      mentions_out: Object.entries(mentions).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([handle, count]) => ({ handle, count, known: by.has(handle + '|' + a.platform) })),
      meta: await getMeta(id),
    };
  }

  // ── connection strength between one account and the rest ──
  function edgesFor(a, by, idf, hDF, wDF) {
    const out = [];
    for (const b of by.values()) {
      if (b.id === a.id) continue;
      const why = [];
      let w = 0;
      // shared hashtags, rarity-weighted
      let hs = 0, hn = 0; a._H.forEach((h) => { if (b._H.has(h)) { hs += idf(hDF[h]); hn++; } });
      if (hn) { w += hs; why.push({ kind: 'hashtags', n: hn }); }
      // shared distinctive words
      let ws = 0, wn = 0; a._W.forEach((x) => { if (b._W.has(x)) { ws += 0.5 * idf(wDF[x]); wn++; } });
      if (wn) { w += ws; }
      // mentions (either direction)
      const mAB = a._mentions.has(b.author.toLowerCase()), mBA = b._mentions.has(a.author.toLowerCase());
      if (mAB || mBA) { w += 3; why.push({ kind: 'mentions' }); }
      if (w > 0) out.push({ id: b.id, author: b.author, platform: b.platform, author_url: b.author_url, w: +w.toFixed(2), why, shared_hashtags: hn, shared_words: wn });
    }
    return out.sort((x, y) => y.w - x.w);
  }

  // ── the whole web, capped to the most active accounts ──
  async function graph(opts = {}) {
    const { by, idf, hDF, wDF } = await build();
    const { byItem } = await voteIndex();
    let accounts = [...by.values()];
    if (opts.topic) accounts = accounts.filter((a) => a.items.some((it) => (byItem.get(it.id) || []).some((v) => v.topic_id === opts.topic)));
    accounts.sort((a, b) => b.items.length - a.items.length);
    const cap = Math.min(opts.max || 60, 120);
    const top = accounts.slice(0, cap);
    const topSet = new Set(top.map((a) => a.id));
    const meta = await allMeta();
    const strength = {}; const edges = [];
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i], b = top[j]; let w = 0, hn = 0;
        a._H.forEach((h) => { if (b._H.has(h)) { w += idf(hDF[h]); hn++; } });
        let wn = 0; a._W.forEach((x) => { if (b._W.has(x)) { w += 0.5 * idf(wDF[x]); wn++; } });
        const ment = a._mentions.has(b.author.toLowerCase()) || b._mentions.has(a.author.toLowerCase());
        if (ment) w += 3;
        if (w >= (opts.min || 1.5) || ment) { edges.push({ a: a.id, b: b.id, w: +w.toFixed(2), h: hn, m: ment ? 1 : 0 }); strength[a.id] = (strength[a.id] || 0) + w; strength[b.id] = (strength[b.id] || 0) + w; }
      }
    }
    // hand-added links always show
    for (const a of top) (meta[a.id]?.links || []).forEach((lid) => { if (topSet.has(lid) && !edges.some((e) => (e.a === a.id && e.b === lid) || (e.a === lid && e.b === a.id))) edges.push({ a: a.id, b: lid, w: 2, h: 0, m: 0, you: 1 }); });
    const nodes = top.map((a) => ({ id: a.id, author: a.author, platform: a.platform, n: a.items.length, strength: +(strength[a.id] || 0).toFixed(1), attrs: (meta[a.id]?.attrs || []).slice(0, 4), topics: [...new Set(a.items.flatMap((it) => (byItem.get(it.id) || []).map((v) => v.topic_id)))].length }));
    return { nodes, edges, total_accounts: by.size, shown: nodes.length, generated: now() };
  }

  // ── people list (ranked), for the NETWORK view's side list ──
  async function list(opts = {}) {
    const { by, idf, hDF, wDF } = await build();
    const { byItem, topics } = await voteIndex();
    const meta = await allMeta();
    let rows = [...by.values()];
    if (opts.topic) rows = rows.filter((a) => a.items.some((it) => (byItem.get(it.id) || []).some((v) => v.topic_id === opts.topic)));
    if (opts.q) { const q = opts.q.toLowerCase(); rows = rows.filter((a) => (a.author + ' ' + a.author_name).toLowerCase().includes(q)); }
    const out = rows.map((a) => {
      const cad = cadence(a.items);
      const tset = new Set(); a.items.forEach((it) => (byItem.get(it.id) || []).forEach((v) => tset.add(topics[v.topic_id])));
      const media = {}; a.items.forEach((it) => { const m = it.media || 'video'; media[m] = (media[m] || 0) + 1; });
      return { id: a.id, author: a.author, author_name: a.author_name, platform: a.platform, author_url: a.author_url, n: a.items.length, per_week: cad.per_week, last: cad.last, topics: [...tset].filter(Boolean).slice(0, 4), media, hashtags: topCount(a.items, (it) => [...hashSet(it)], 4).map((x) => x.value), attrs: (meta[a.id]?.attrs || []).slice(0, 4), has_notes: !!(meta[a.id]?.notes) };
    });
    const SO = { active: (x, y) => (y.last || 0) - (x.last || 0), cadence: (x, y) => y.per_week - x.per_week, name: (x, y) => x.author.localeCompare(y.author) };
    out.sort(SO[opts.sort] || ((x, y) => y.n - x.n));
    return { people: out, total: out.length };
  }

  // ── the WORD web: @accounts + #hashtags + words/"phrases" as one graph ──
  // focus: '@name' | '#tag' | '"a phrase"' | 'word' → the web is centred on it.
  function parseFocus(f) {
    f = String(f || '').trim(); if (!f) return null;
    if (f[0] === '@') return { kind: 'account', key: f.slice(1).toLowerCase() };
    if (f[0] === '#') return { kind: 'hashtag', key: f.slice(1).toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '') };
    const m = f.match(/^"(.+)"$/); const txt = (m ? m[1] : f).toLowerCase().trim();
    return { kind: 'word', key: txt, phrase: txt.includes(' ') };
  }
  const WORD_MIN = 3;
  // words that are about the platform, not the subject
  const BOILER = new Set('video videos watch watching subscribe subscribed follow following like likes liked share shares comment comments channel link links bio click clicks free download full official episode part parts live stream streaming streamed check today tonight tomorrow yesterday week weekend month year years day days hours minutes time new news music song songs sound sounds audio youtube tiktok instagram twitter facebook reddit mastodon bluesky shorts short reel reels post posts posted thread update updates premiere viral trending credit credits source sources original repost reposted http https www com'.split(' '));
  async function wordGraph(opts = {}) {
    const { by, idf, hDF, wDF } = await build();
    const kinds = new Set((opts.kinds || 'account,hashtag,word').split(',').filter(Boolean));
    const cap = Math.min(opts.max || 80, 160);
    const focus = parseFocus(opts.focus);
    const items = await idb.all('items');
    // per-post term sets → co-occurrence; per-account usage counts
    const nodeW = {}, edgeW = {}; const kindOf = {}; const nodeN = {};          // nodeN = posts behind each node
    const bump = (k, w) => { nodeW[k] = (nodeW[k] || 0) + w; nodeN[k] = (nodeN[k] || 0) + 1; };
    const edgeT = {};   // best (lowest) tier seen for the pair
    const link = (a, b, w, t = 3) => { if (a === b) return; const k = a < b ? a + '\u0001' + b : b + '\u0001' + a; edgeW[k] = (edgeW[k] || 0) + w; edgeT[k] = Math.min(edgeT[k] || 9, t); };
    const acctId = (it) => '@' + String(it.author || '').toLowerCase() + '|' + (it.platform || '');
    // words that appear in more than a third of all posts are boilerplate here ("video", "new"…):
    // they'd bridge every community into one blob, so they're left out of the web
    const postDF = {}; let nPosts = 0;
    for (const it of items) { if (!it.author) continue; nPosts++; new Set(tokens(it.text).filter((w) => w.length > WORD_MIN && !STOP.has(w))).forEach((w) => postDF[w] = (postDF[w] || 0) + 1); }
    // …but never the word you centred on, and never a word that is also used as a hashtag (then it's a subject, not filler)
    const tagWords = new Set(); for (const it of items) hashSet(it).forEach((h) => tagWords.add(h));
    const focusWords = new Set(focus && focus.kind === 'word' ? focus.key.split(/\s+/) : []);
    // platform boilerplate is named outright; the statistical net only catches words used by nearly EVERY
    // account AND in most posts (a single-topic library's own key words legitimately run high)
    const acctDF = {}; for (const a of by.values()) { const seen = new Set(); a.items.forEach((it) => tokens(it.text).forEach((w) => seen.add(w))); seen.forEach((w) => acctDF[w] = (acctDF[w] || 0) + 1); }
    const nAcc = Math.max(1, by.size);
    const generic = (w) => !focusWords.has(w) && !tagWords.has(w) && (BOILER.has(w) || (nPosts >= 50 && nAcc >= 20 && postDF[w] / nPosts > 0.7 && acctDF[w] / nAcc > 0.9));
    for (const it of items) {
      if (!it.author) continue;
      const A = acctId(it); kindOf[A] = 'account';
      const tags = [...hashSet(it)].map((h) => '#' + h);
      const words = [...new Set(tokens(it.text).filter((w) => w.length > WORD_MIN && !STOP.has(w) && !generic(w)))].map((w) => 'w:' + w);
      if (focus && focus.kind === 'word' && focus.phrase) {              // a quoted phrase is its own node
        const txt = String(it.text || '').toLowerCase(); if (txt.includes(focus.key)) { words.push('w:' + focus.key); }
      }
      tags.forEach((t) => { kindOf[t] = 'hashtag'; bump(t, idf(hDF[t.slice(1)])); link(A, t, 1, 2); });
      // real relationships written in the post: @mentions of accounts we know
      mentionsIn(it.text).forEach((m) => { const B = Object.keys(kindOf).find((k) => k.startsWith('@' + m + '|')) || ('@' + m + '|' + (it.platform || '')); if (kindOf[B] === 'account' && B !== A) link(A, B, 2, 1); });
      words.forEach((w) => { kindOf[w] = 'word'; bump(w, 0.6 * idf(wDF[w.slice(2)] || 1)); link(A, w, 0.6); });
      bump(A, 1);
      // co-occurrence inside the post (cheap: tags×tags, tags×words; words×words only for short posts)
      for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) link(tags[i], tags[j], 1.2, 2);
      // co-occurrence among the post's 12 most distinctive words (long descriptions included), and tags×words
      // co-occurrence the way text-network tools do it: terms inside a sliding 4-word window link strongly,
      // terms merely in the same post link weakly (first 40 distinctive terms, text order)
      const seq = []; { const seen = new Set(); let pos = 0; for (const w of tokens(it.text)) { pos++; const k = 'w:' + w; if (kindOf[k] === 'word' && !seen.has(k)) { seen.add(k); seq.push([k, pos]); if (seq.length >= 40) break; } } }
      const wTop = seq.map((x) => x[0]);
      tags.forEach((t) => wTop.forEach((w) => link(t, w, 0.5, 3)));
      for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) link(seq[i][0], seq[j][0], seq[j][1] - seq[i][1] <= 4 ? 1 : 0.25);
    }
    // account↔account edges from the existing shared-content model
    for (const a of by.values()) for (const e of edgesFor(a, by, idf, hDF, wDF).slice(0, 6)) {
      const A = '@' + a.author.toLowerCase() + '|' + a.platform, B = '@' + e.author.toLowerCase() + '|' + e.platform;
      kindOf[A] = kindOf[B] = 'account'; link(A, B, e.w * 0.5, e.why.some((x) => x.kind === 'mentions') ? 1 : e.shared_hashtags ? 2 : 3);
    }
    // ── term selection (VOSviewer): minimum occurrences, then keep the most *relevant* 60% ──
    //    relevance = how specific a term is to a few accounts (spread-evenly-everywhere terms score low)
    const minOcc = Math.max(2, Math.round(nPosts * 0.01));
    const wordIds = Object.keys(kindOf).filter((k) => kindOf[k] === 'word');
    const keepW = new Set(); const isFocusWord = (k) => focus && focus.kind === 'word' && k === 'w:' + focus.key;
    const scored = wordIds.filter((k) => (nodeN[k] || 0) >= minOcc || isFocusWord(k)).map((k) => [k, (nodeN[k] || 0) * Math.log((nAcc + 1) / ((acctDF[k.slice(2)] || 0) + 1))]).sort((a, b) => b[1] - a[1]);
    scored.slice(0, Math.max(10, Math.ceil(scored.length * 0.6))).forEach(([k]) => keepW.add(k)); scored.forEach(([k]) => { if (isFocusWord(k)) keepW.add(k); });
    for (const k of wordIds) if (!keepW.has(k)) { delete kindOf[k]; delete nodeW[k]; }
    for (const k in edgeW) { const [a, b] = k.split('\u0001'); if (!kindOf[a] || !kindOf[b]) delete edgeW[k]; }
    // ── edge weights (association strength): co-occurrence vs. what chance predicts from each term's frequency ──
    for (const k in edgeW) { const [a, b] = k.split('\u0001'); if (kindOf[a] === 'account' || kindOf[b] === 'account') continue;
      const co = edgeW[k], oa = nodeN[a] || 1, ob = nodeN[b] || 1; const as = nPosts * co / (oa * ob);   // >1 = more than chance
      edgeW[k] = Math.sqrt(co) * Math.log(1 + as); }
    // pick nodes: around the focus, else the heaviest of each kind
    let ids;
    const focusId = focus ? (focus.kind === 'account' ? Object.keys(kindOf).find((k) => k.startsWith('@' + focus.key + '|')) : focus.kind === 'hashtag' ? '#' + focus.key : 'w:' + focus.key) : null;
    const nb = (id) => { const out = []; for (const k in edgeW) { const [x, y] = k.split('\u0001'); if (x === id) out.push([y, edgeW[k], edgeT[k]]); else if (y === id) out.push([x, edgeW[k], edgeT[k]]); } return out.sort((p, q) => (p[2] - q[2]) || (q[1] - p[1])); };
    if (focusId && (kindOf[focusId] || nodeW[focusId])) {
      const first = nb(focusId).filter(([k]) => kinds.has(kindOf[k])).slice(0, Math.floor(cap * 0.6));
      const seen = new Set([focusId, ...first.map((p) => p[0])]);
      for (const [k] of first) { for (const [k2] of nb(k).slice(0, 4)) { if (seen.size >= cap) break; if (kinds.has(kindOf[k2])) seen.add(k2); } }
      ids = [...seen];
    } else {
      const per = { account: Math.round(cap * 0.4), hashtag: Math.round(cap * 0.3), word: Math.round(cap * 0.3) };
      ids = [];
      for (const kind of ['account', 'hashtag', 'word']) if (kinds.has(kind)) ids.push(...Object.keys(nodeW).filter((k) => kindOf[k] === kind).sort((a, b) => nodeW[b] - nodeW[a]).slice(0, per[kind]));
    }
    const idset = new Set(ids);
    const edges = []; for (const k in edgeW) { const [a, b] = k.split('\u0001'); if (idset.has(a) && idset.has(b)) edges.push({ a, b, w: +edgeW[k].toFixed(2), t: edgeT[k] || 3 }); }
    // keep the strongest links overall PLUS every node's own strongest few, so nothing is left dangling
    edges.sort((p, q) => (p.t - q.t) || (q.w - p.w));
    const keep = new Set(edges.filter((e) => e.t === 1).concat(edges.slice(0, cap * 4))); const per = {};
    for (const e of edges) { (per[e.a] = per[e.a] || []).push(e); (per[e.b] = per[e.b] || []).push(e); }
    for (const id in per) per[id].slice(0, 4).forEach((e) => keep.add(e));
    const E = [...keep];
    const deg = {}; E.forEach((e) => { deg[e.a] = (deg[e.a] || 0) + e.w; deg[e.b] = (deg[e.b] || 0) + e.w; });
    const meta = await allMeta();
    const nodes = ids.map((id) => { const kind = kindOf[id] || 'word'; const label = kind === 'account' ? id.slice(1).split('|')[0] : kind === 'hashtag' ? id : id.slice(2);
      return { id, kind, label, n: nodeN[id] || 0, w: +(nodeW[id] || 0).toFixed(2), strength: +(deg[id] || 0).toFixed(1), person_id: kind === 'account' ? [...by.values()].find((a) => '@' + a.author.toLowerCase() + '|' + a.platform === id)?.id || null : null, attrs: kind === 'account' ? ((meta[[...by.values()].find((a) => '@' + a.author.toLowerCase() + '|' + a.platform === id)?.id]?.attrs) || []).slice(0, 3) : [] }; });
    return { nodes, edges: E, focus: focusId && idset.has(focusId) ? focusId : null, focus_asked: opts.focus || '', kinds: [...kinds], generated: now() };
  }

  // ── "load more posts": pull an account's own recent posts into the library, no rating needed.
  //    They show up in LIBRARY and the WEB straight away — the point is seeing an account en masse.
  async function loadMore(id, body) {
    const { by } = await build();
    const a = by.get(id); if (!a) return { error: 'no account' };
    const j = L.newJob('collect', 'more from @' + a.author);
    L.runSafe(j, async () => {
      const params = new URLSearchParams({ platform: a.platform, handle: a.author, url: a.author_url || '', limit: Math.min(+body.limit || 50, 100), media: body.media || 'all' });
      j.log('▶ ' + a.platform + ' · @' + a.author);
      const r = await L.workerCall('/account?' + params);
      let found = 0, added = 0;
      for (const it of (r.items || [])) {
        if (!it || !it.id) continue;
        found++; it.collected_at = now();
        if (!(await idb.get('items', it.id))) added++;
        await idb.put('items', it);
      }
      j.stats.found = found; j.stats.new = added; j.result = { found, new: added, author: a.author };
      j.log('  ' + found + ' posts, ' + added + ' new');
    });
    return L.jobDict(j);
  }

  // ── router (mirrors the server-style API the app calls) ──
  L.people = {
    profile, graph, list, setMeta, getMeta,
    async request(method, parts, qs, body) {
      const P = Object.fromEntries(new URLSearchParams(qs || ''));
      const id = parts[1] ? decodeURIComponent(parts[1]) : null;
      if (parts[0] === 'graph') {
        if (P.focus !== undefined || P.kinds !== undefined) return wordGraph({ focus: P.focus || '', kinds: P.kinds || 'account,hashtag,word', max: +P.max || 80 });
        return graph({ topic: P.topic || null, max: +P.max || 60, min: +P.min || 1.5 });
      }
      if (!id) return list({ topic: P.topic || null, q: P.q || '', sort: P.sort || '' });
      if (parts[2] === 'more' && method === 'POST') return loadMore(id, body || {});
      if (method === 'GET') return profile(id);
      if (method === 'PATCH') return setMeta(id, body || {});
      return { error: 'people route not available: ' + parts.join('/') };
    },
  };
})();
