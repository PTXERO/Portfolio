// open topics: two different people on the same hub. A starts one, B sees and joins it, their ratings pool, A's delete archives it.
const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8774', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? '✓ ' : '✗ ') + m); };
const browser = await pw.chromium.launch();
const NOW = Math.floor(Date.now() / 1000); const log = [];
const hub = { topics: {}, votes: {}, stores: {} };   // a tiny in-memory hub: per-id store + open topics
const post = (id, author, text) => ({ id: 'mastodon:' + id, platform: 'mastodon', post_id: String(id), media: 'post', url: 'https://m.example/@' + author + '/' + id, author, author_name: author, text, hashtags: 'isaias', posted_at: NOW - 3600 * id, likes: 2, reposts: 0, replies: 0, views: 0 });
const mockHub = async (route) => {
  const req = route.request(); const u = new URL(req.url()); const uid = req.headers()['x-px-uid'] || 'anon'; log.push(uid + ' ' + req.method() + ' ' + u.pathname);
  const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(o) });
  if (req.method() === 'OPTIONS') return json({});
  if (u.pathname === '/health') return json({ ok: true, worker: 'searchnet', version: '1.8', hub: '2.1' });
  if (u.pathname === '/me') return json({ uid, owner: false, today: { fetch: 0, writes: 0 }, limits: { fetch: 400, writes: 300 }, store: { bytes: 0, blobs: 0, by_app: {} } });
  if (u.pathname === '/id') return json({ ok: true });
  const sm = u.pathname.match(/^\/store\/searchnet\/backup$/);
  if (sm && req.method() === 'GET') return hub.stores[uid] ? json({ data: hub.stores[uid] }) : json({ error: 'not found' }, 404);
  if (sm && req.method() === 'PUT') { hub.stores[uid] = JSON.parse(req.postData() || '{}'); return json({ ok: true, bytes: 10 }); }
  if (u.pathname === '/search') return json({ items: u.searchParams.get('source') === 'mastodon' ? [post(1, 'storm', 'Isaias storm surge hits Tampa Bay #isaias'), post(2, 'cleanup', 'Isaias cleanup crews out #isaias'), post(3, 'other', 'Totally unrelated post #isaias')] : [] });
  const tm = u.pathname.match(/^\/topics(?:\/([A-Za-z0-9_-]+)(?:\/(votes|items))?)?$/);
  if (tm) {
    const tid = tm[1], sub = tm[2]; const stat = (id) => { const vs = Object.values(hub.votes).filter((v) => v.topic_id === id); return { ratings: vs.length, people: new Set([hub.topics[id].uid, ...vs.map((v) => v.uid)]).size }; };
    if (req.method() === 'GET' && !tid) return json({ topics: Object.values(hub.topics).filter((t) => !t.deleted).map((t) => Object.assign({ id: t.id, name: t.name, seeds: t.seeds, kind: t.kind, started_by: t.uid, updated_at: new Date().toISOString() }, stat(t.id))) });
    if (req.method() === 'GET' && tid && !sub) { const t = hub.topics[tid]; if (!t || t.deleted) return json({ error: 'not found' }, 404); const pool = {}; Object.values(hub.votes).filter((v) => v.topic_id === tid).forEach((v) => { const q = pool[v.item_id] = pool[v.item_id] || { pos: 0, neg: 0 }; if (v.label > 0) q.pos++; else if (v.label < 0) q.neg++; }); return json(Object.assign({ id: t.id, name: t.name, seeds: t.seeds, settings: t.settings, kind: t.kind, started_by: t.uid, pool }, stat(tid))); }
    if (req.method() === 'PUT') { const b = JSON.parse(req.postData() || '{}'); if (b.kind === 'person') return json({ error: 'never' }, 403); const have = hub.topics[tid]; if (have && have.uid !== uid) return json({ error: 'started by someone else' }, 403); hub.topics[tid] = { id: tid, uid: have ? have.uid : uid, name: b.name, seeds: b.seeds, settings: b.settings || {}, kind: b.kind, deleted: false }; return json({ ok: true, id: tid, started_by: hub.topics[tid].uid }); }
    if (req.method() === 'DELETE') { const have = hub.topics[tid]; if (!have) return json({ error: 'not found' }, 404); if (have.uid !== uid) return json({ error: 'no' }, 403); have.deleted = true; return json({ ok: true }); }
    if (req.method() === 'GET' && sub === 'items') { const since = +(u.searchParams.get('since') || 0); const rows = Object.values(hub.items || {}).filter((r) => r.topic_id === tid && r.ts > since); return json({ id: tid, items: rows.map((r) => r.data), ts: rows.length ? Math.max(...rows.map((r) => r.ts)) : since }); }
    if (req.method() === 'POST' && sub === 'items') { const b = JSON.parse(req.postData() || '{}'); const ts = Math.floor(Date.now() / 1000) + Object.keys(hub.items || {}).length; hub.items = hub.items || {}; (b.items || []).forEach((it) => hub.items[tid + '|' + it.id] = { topic_id: tid, item_id: it.id, data: it, ts }); return json({ ok: true, saved: (b.items || []).length, ts }); }
    if (req.method() === 'POST' && sub === 'votes') { const b = JSON.parse(req.postData() || '{}'); (b.votes || []).forEach((v) => hub.votes[tid + '|' + uid + '|' + v.item_id] = { topic_id: tid, uid, item_id: v.item_id, label: v.label }); return json({ ok: true, saved: (b.votes || []).length }); }
  }
  return json({ error: 'unmocked ' + u.pathname }, 404);
};
const errs = []; const device = async () => { const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } }); await ctx.route(/share\.ptxero\.net/, mockHub); await ctx.route(/wikipedia|wikimedia|datamuse|googleapis|gstatic/, (r) => r.abort()); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.goto('http://127.0.0.1:8774/searchnet/index.html?mode=browser#topics', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500); return p; };
const api = (p, path, opts) => p.evaluate(([path, opts]) => window.SearchNetLocal.request(path, opts), [path, opts]);
const syncOpen = (p) => p.evaluate(() => syncOpenTopics());
const A = await device(), B = await device();
const uidA = await A.evaluate(() => PX.suffix()), uidB = await B.evaluate(() => PX.suffix());
ok(uidA !== uidB, 'two devices, two different ids (@' + uidA + ', @' + uidB + ')');
if (!(await api(A, '/api/sources')).sources.some((x) => x.source === 'mastodon')) await api(A, '/api/sources', { method: 'POST', body: { preset: 'mastodon', param: 'mastodon.social' } });
const t = await api(A, '/api/topics', { method: 'POST', body: { name: 'Tropical Storm Isaias', seeds: ['isaias'], settings: { window: 'all', media: 'everything' }, run: false } });
await syncOpen(A); await A.waitForTimeout(300);
ok(hub.topics[t.id] && hub.topics[t.id].uid === uidA, 'A\'s open topic is published on the hub, started by @' + uidA);
const tA = await api(A, '/api/topics/' + t.id); ok(tA.settings.shared && tA.settings.shared.started_by === uidA, 'A\'s copy remembers it started it');
await B.evaluate(() => { location.hash = '#topics'; }); await syncOpen(B); await B.waitForTimeout(500);
const bodyB = await B.textContent('#hubTopics').catch(() => '');
ok(/Open on this hub/.test(bodyB) && /Tropical Storm Isaias/.test(bodyB) && new RegExp('started by @' + uidA).test(bodyB), 'B sees it under "Open on this hub", started by @' + uidA);
await B.click('[data-joinbtn="' + t.id + '"]'); await B.waitForTimeout(800);
const tB = await api(B, '/api/topics/' + t.id);
ok(tB && tB.id === t.id && tB.settings.visibility === 'open' && tB.settings.shared.started_by === uidA, 'B joins: same id, open, started by @' + uidA);
// A rates; B's copy gets the pooled rating without rating anything itself
const jA = await api(A, '/api/topics/' + t.id + '/run', { method: 'POST' }); for (let i = 0; i < 60; i++) { const st = await A.evaluate((id) => (window.SearchNetLocal.jobs[id] || {}).state, jA.id); if (st === 'done' || st === 'error') break; await A.waitForTimeout(300); }
await api(A, '/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: 'mastodon:1', label: 1 } });
await api(A, '/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: 'mastodon:3', label: -1 } });
await syncOpen(A); await A.waitForTimeout(300);
ok(Object.keys(hub.votes).length === 2, 'A\'s two ratings are on the hub');
ok(Object.keys(hub.items || {}).length >= 2, 'the posts A pulled into the topic are on the hub (' + Object.keys(hub.items || {}).length + ')');
await syncOpen(B); await B.waitForTimeout(500);
const vB = await B.evaluate((tid) => window.SearchNetLocal.idb.all('votes').then((vs) => vs.filter((v) => v.topic_id === tid)), t.id);
ok(vB.some((v) => v.item_id === 'mastodon:1' && v.label === 1 && v.from === 'hub') && vB.some((v) => v.item_id === 'mastodon:3' && v.label === -1 && v.from === 'hub'), 'B\'s copy carries the pooled ratings, marked as the hub\'s (' + vB.map((v) => v.item_id + ':' + v.label + (v.from ? '/' + v.from : '')).join(', ') + ')');
const itemsB = await B.evaluate(() => window.SearchNetLocal.idb.all('items')); ok(itemsB.some((it) => it.id === 'mastodon:1') && itemsB.some((it) => it.id === 'mastodon:3'), 'B now holds the posts without fetching (' + itemsB.length + ' in its library)');
const feedB = await api(B, '/api/topics/' + t.id + '/feed?view=review&limit=20'); ok((feedB.items || []).length >= 1, 'B\'s review is not empty (' + (feedB.items || []).length + ')');
const gB = await api(B, '/api/graph?' + new URLSearchParams({ topic: t.id, kinds: 'account,hashtag,word,entity', max: 80 })); ok(gB.nodes.length > 0, 'B\'s web is not empty (' + gB.nodes.length + ' nodes)');
ok(/from the hub/.test(await B.textContent('#topicList')), 'B\'s card says how many posts came from the hub');
// B disagrees on one: its own rating wins on its device and goes up; A keeps its own
await api(B, '/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: 'mastodon:1', label: -1 } }); await syncOpen(B); await B.waitForTimeout(300);
const vB2 = await B.evaluate((tid) => window.SearchNetLocal.idb.all('votes').then((vs) => vs.filter((v) => v.topic_id === tid && v.item_id === 'mastodon:1')[0]), t.id);
ok(vB2.label === -1 && vB2.from !== 'hub' && hub.votes[t.id + '|' + uidB + '|mastodon:1'].label === -1, 'B\'s own rating wins on B and is pooled');
const backupB = await B.evaluate(() => window.SearchNetLocal.backup()); ok(!(backupB.votes || []).some((v) => v.from === 'hub') && (backupB.votes || []).some((v) => v.item_id === 'mastodon:1'), 'pooled ratings stay out of B\'s backup, B\'s own goes in');
const tBc = await B.textContent('#topicList'); ok(new RegExp('open · started by @' + uidA).test(tBc), 'B\'s card says who started it');
// a person topic never goes up
const jd = await api(A, '/api/topics', { method: 'POST', body: { name: 'Jane Doe', seeds: ['Jane Doe'], run: false } }); await syncOpen(A);
ok(!hub.topics[jd.id] && jd.settings.visibility === 'private', 'a topic about a named person is never published');
// A deletes: archived on the hub, B keeps its copy
await A.evaluate((tid) => { location.hash = '#topic/' + tid; }, t.id); await A.waitForTimeout(1500);
await A.click('#tMenu'); await A.waitForTimeout(600); await A.click('#tsDel'); await A.waitForTimeout(400); await A.click('#sheet button:has-text("DELETE")'); await A.waitForTimeout(800);
ok(hub.topics[t.id].deleted === true, 'A deleting its topic archives it on the hub' + (hub.topics[t.id].deleted ? '' : ' · log: ' + log.filter((l) => /DELETE|tsDel/.test(l)).join(' ; ') + ' · sheet: ' + (await A.textContent('#sheet').catch(() => '')).slice(0, 80)));
await syncOpen(B); await B.waitForTimeout(300);
ok(!!(await api(B, '/api/topics/' + t.id)).id, 'B keeps its copy');
ok(errs.length === 0, 'no page errors' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); srv.kill(); process.exit(bad ? 1 : 0);
