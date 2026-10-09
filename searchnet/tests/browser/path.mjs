// WEB: the chain between two things ("to"), and + DOSSIER from the centred node
const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8773', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? '✓ ' : '✗ ') + m); };
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const NOW = Math.floor(Date.now() / 1000);
const post = (id, author, text, ts, kw = {}) => Object.assign({ id: 'mastodon:' + id, platform: 'mastodon', post_id: String(id), media: 'post', url: 'https://m.example/@' + author + '/' + id, author, author_name: author, text, hashtags: '', posted_at: ts, likes: 2, reposts: 0, replies: 0, views: 0 }, kw);
// Furnace Fest ← alice (names it, twice) ← bob mentions alice → bob names Hurricane Isaias. carl is off on his own.
const items = [
  post('a1', 'alice', 'Furnace Fest lineup is out and it is stacked #furnacefest', NOW - 3 * 86400),
  post('a2', 'alice', 'Furnace Fest day two, best set of the weekend #furnacefest', NOW - 2 * 86400),
  post('b1', 'bob', 'great photos @alice from the weekend', NOW - 2 * 86400 + 100),
  post('b2', 'bob', 'Hurricane Isaias is turning north, Duke Energy warns of outages #isaias', NOW - 86400),
  post('b3', 'bob', 'Hurricane Isaias update: still no power in Collier #isaias', NOW - 80000),
  post('c1', 'carl', 'Hurricane Isaias radar looks rough tonight #isaias', NOW - 70000),
  post('c2', 'carl', 'nothing to do with anything, sourdough starter day 4', NOW - 60000),
];
await ctx.route(/share\.ptxero\.net/, async (route) => {
  const req = route.request(); const u = new URL(req.url());
  const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(o) });
  if (req.method() === 'OPTIONS') return json({});
  if (u.pathname === '/health') return json({ ok: true, worker: 'searchnet', version: '1.9', hub: '2.0' });
  if (u.pathname === '/me') return json({ uid: 'X', owner: false, today: { fetch: 0, writes: 0 }, limits: { fetch: 400, writes: 300 }, store: { bytes: 0, blobs: 0, by_app: {} } });
  if (u.pathname === '/id') return json({ ok: true });
  if (u.pathname === '/search') return json({ items: u.searchParams.get('source') === 'mastodon' ? items : [] });
  return json({ error: 'unmocked ' + u.pathname }, 404);
});
await ctx.route(/wikipedia|wikimedia|datamuse|googleapis|gstatic/, (r) => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:8773/searchnet/index.html?mode=browser#sources', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const api = (path, opts) => p.evaluate(([path, opts]) => window.SearchNetLocal.request(path, opts), [path, opts]);
if (!(await api('/api/sources')).sources.some((x) => x.source === 'mastodon')) await api('/api/sources', { method: 'POST', body: { preset: 'mastodon', param: 'mastodon.social' } });
const t = await api('/api/topics', { method: 'POST', body: { name: 'Everything', seeds: ['weekend'], settings: { breadth: 1, media: 'everything', window: 'all' }, run: false } });
const j = await api('/api/topics/' + t.id + '/run', { method: 'POST' });
for (let i = 0; i < 80; i++) { const st = await p.evaluate((id) => (window.SearchNetLocal.jobs[id] || {}).state, j.id); if (st === 'done' || st === 'error') break; await p.waitForTimeout(300); }
// API: the chain
const g = await api('/api/graph?' + new URLSearchParams({ focus: '"furnace fest"', to: '"hurricane isaias"', kinds: 'account,hashtag,word,entity', max: 80, hops: 2, via: 'm,f,e,h,s' }));
ok(g.focus === 'e:furnace fest' && g.to === 'e:hurricane isaias', 'graph: both ends resolve to named things (' + g.focus + ' → ' + g.to + ')');
ok(g.path.length >= 3 && g.path[0] === 'e:furnace fest' && g.path[g.path.length - 1] === 'e:hurricane isaias', 'graph: a chain joins them: ' + g.path.join(' → '));
ok(g.path.includes('@alice|mastodon') && g.path.includes('@bob|mastodon'), 'graph: it goes through @alice and @bob (the mention)');
ok(g.path_edges.length === g.path.length - 1 && g.path_edges.every(Boolean), 'graph: every step has its edge with evidence');
ok(g.nodes.every((n) => g.path.includes(n.id) || n.hop >= 1), 'graph: chain nodes first, context around them');
const g2 = await api('/api/graph?' + new URLSearchParams({ focus: '"furnace fest"', to: '"sourdough starter"', kinds: 'account,hashtag,word,entity', max: 80 }));
ok(!g2.path.length && /nothing collected|no chain/.test(g2.path_missing), 'graph: an unknown second thing says so (' + g2.path_missing + ')');
const g3 = await api('/api/graph?' + new URLSearchParams({ focus: '"furnace fest"', to: '"furnace fest"', kinds: 'account,entity', max: 80 }));
ok(!g3.path.length && /same thing/.test(g3.path_missing), 'graph: same thing twice says so');
// UI: deep link with to=
await p.goto('http://127.0.0.1:8773/searchnet/index.html?mode=browser#network?' + new URLSearchParams({ focus: '"furnace fest"', to: '"hurricane isaias"' }), { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
const bar = await p.evaluate(() => (document.querySelector('.web .focus') || {}).textContent || '');
ok(/Furnace Fest/.test(bar) && /⟶/.test(bar) && /Hurricane Isaias/.test(bar) && /links apart/.test(bar), 'web: focus bar shows A ⟶ B and how far apart (' + bar.trim().replace(/\s+/g, ' ').slice(0, 90) + ')');
const why = await p.evaluate(() => (document.querySelector('#nwWhy') || {}).textContent || '');
ok(/How ◆ Furnace Fest connects to ◆ Hurricane Isaias/.test(why) && /@alice/.test(why) && /@bob/.test(why), 'web: the chain card lists each link (' + why.replace(/\s+/g, ' ').slice(0, 120) + '…)');
ok(await p.evaluate(() => document.querySelectorAll('#nwWhy .drow').length) === (g.path.length - 1), 'web: one row per link');
ok(await p.evaluate(() => document.querySelectorAll('#nwWhy .drow a.pill[href^="http"]').length) >= 2, 'web: rows link to the posts they come from');
// + DOSSIER on the centred node → a topic, then OPEN DOSSIER next time
ok(await p.evaluate(() => (document.querySelector('[data-fdossier]') || {}).textContent) === '+ DOSSIER', 'web: + DOSSIER offered on the centred node');
await p.click('[data-fdossier]'); await p.waitForTimeout(1500);
const ts = (await api('/api/topics')).topics;
const ff = ts.find((x) => x.name === 'Furnace Fest');
ok(!!ff && ff.seeds.some((x) => x.toLowerCase() === '"furnace fest"'), 'dossier: a Furnace Fest topic started from the node (' + (ff ? ff.seeds.join(', ') : 'none') + ')');
ok(await p.evaluate(() => location.hash.includes('/dossier')), 'dossier: the page opens on it');
await p.goto('http://127.0.0.1:8773/searchnet/index.html?mode=browser#network?' + new URLSearchParams({ focus: '"furnace fest"' }), { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
ok(await p.evaluate(() => (document.querySelector('[data-fdossier]') || {}).textContent) === 'OPEN DOSSIER', 'web: once it exists the button opens it');
// an @account → its own-feed dossier (private, person mode account)
await p.goto('http://127.0.0.1:8773/searchnet/index.html?mode=browser#network?' + new URLSearchParams({ focus: '@bob' }), { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
await p.click('[data-fdossier]'); await p.waitForTimeout(1500);
const tb = (await api('/api/topics')).topics.find((x) => x.name === '@bob');
ok(!!tb && tb.settings.person && tb.settings.person.mode === 'account' && tb.settings.person.platform === 'mastodon' && tb.seeds[0] === '@bob', 'dossier: @bob → its own-feed dossier (' + (tb ? tb.seeds.join(', ') : 'none') + ')');
ok(errs.length === 0, 'no page errors' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); srv.kill(); process.exit(bad ? 1 : 0);
