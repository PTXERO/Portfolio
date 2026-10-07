const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8769', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? '✓ ' : '✗ ') + m); };
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const NOW = Math.floor(Date.now() / 1000);
const art = (id, host, outlet, text, ts) => ({ id: 'news:' + id, platform: 'news', post_id: id, media: 'post', url: 'https://www.' + host + '/' + id, author: host, author_name: outlet, text, posted_at: ts, hashtags: '', likes: 0, views: 0 });
const hubLog = [];
await ctx.route(/share\.ptxero\.net/, async (route) => {
  const req = route.request(); const u = new URL(req.url()); hubLog.push(req.method() + ' ' + u.pathname + u.search);
  const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(o) });
  if (req.method() === 'OPTIONS') return json({});
  if (u.pathname === '/health') return json({ ok: true, worker: 'searchnet', version: '1.8', hub: '2.0' });
  if (u.pathname === '/me') return json({ uid: 'X', owner: false, today: { fetch: 0, writes: 0 }, limits: { fetch: 400, writes: 300 }, store: { bytes: 0, blobs: 0, by_app: {} } });
  if (u.pathname === '/id') return json({ ok: true });
  if (u.pathname === '/search') {
    if (u.searchParams.get('source') !== 'news') return json({ items: [] });
    return json({ items: [art('a1', 'naplesnews.com', 'Naples Daily News', 'Isaias: Duke Energy restores power in Collier', NOW - 86400 * 400),
      art('a2', 'naplesnews.com', 'Naples Daily News', 'Isaias moves north past Fort Myers', NOW - 86400 * 2),
      art('a3', 'tampabay.com', 'Tampa Bay Times', 'Isaias aftermath across Florida', NOW - 86400)] });
  }
  if (u.pathname === '/article') {
    const url = u.searchParams.get('url');
    if (url.endsWith('/a1')) return json({ url, text: 'NAPLES, Fla. — ' + 'Duke Energy crews restored power across Collier County after Hurricane Isaias. '.repeat(6), byline: ['Jane Doe', 'Bob Roe'], author_url: 'https://www.naplesnews.com/staff/jane-doe', dateline: 'Naples, Fla.', published: NOW - 86400 * 400 });
    if (url.endsWith('/a2')) return json({ url, text: 'FORT MYERS — ' + 'Duke Energy said Hurricane Isaias was past the coast. '.repeat(6), byline: ['Jane Doe'], author_url: 'https://www.naplesnews.com/staff/jane-doe', dateline: 'Fort Myers', published: NOW - 86400 * 2 });
    return json({ url, text: 'Reporting by Jane Doe of the Naples Daily News showed Duke Energy was slow after Hurricane Isaias. '.repeat(5), byline: [], author_url: '', dateline: '' });
  }
  if (u.pathname === '/author') return json({ url: u.searchParams.get('url'), name: 'Jane Doe', bio: 'Jane Doe covers the coast for the Daily News.', handles: [{ platform: 'x', handle: 'janedoe', url: 'https://x.com/janedoe' }, { platform: 'bluesky', handle: 'jane.bsky.social', url: 'https://bsky.app/profile/jane.bsky.social' }] });
  return json({ error: 'unmocked ' + u.pathname }, 404);
});
await ctx.route(/wikipedia|wikimedia|datamuse|googleapis|gstatic/, (r) => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:8769/searchnet/index.html?mode=browser#sources', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const api = (path, opts) => p.evaluate(([path, opts]) => window.SearchNetLocal.request(path, opts), [path, opts]);
const t = await api('/api/topics', { method: 'POST', body: { name: 'Hurricane Isaias', seeds: ['hurricane isaias'], settings: { breadth: 1, media: 'everything', window: 'all' }, run: false } });
const j = await api('/api/topics/' + t.id + '/run', { method: 'POST' });
for (let i = 0; i < 80; i++) { const st = await p.evaluate((id) => (window.SearchNetLocal.jobs[id] || {}).state, j.id); if (st === 'done' || st === 'error') break; await p.waitForTimeout(300); }
for (const id of ['news:a1', 'news:a2', 'news:a3']) await api('/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: id, label: 1 } });
const a1 = await p.evaluate(() => window.SearchNetLocal.idb.get('items', 'news:a1'));
ok(a1 && JSON.stringify(a1.byline) === '["Jane Doe","Bob Roe"]' && a1.dateline === 'Naples, Fla.', 'run: byline + dateline stored on the article (' + JSON.stringify(a1 && a1.byline) + ' · ' + (a1 && a1.dateline) + ')');
ok(hubLog.filter((l) => l.startsWith('GET /author')).length === 1, 'run: the writer page read once (' + hubLog.filter((l) => l.startsWith('GET /author')).length + ')');
const g = await api('/api/graph?' + new URLSearchParams({ topic: t.id, kinds: 'account,entity', max: 80 }));
const jd = g.nodes.find((n) => n.kind === 'account' && n.role === 'writer' && n.label === 'Jane Doe');
ok(!!jd, 'web: Jane Doe is a writer node (' + g.nodes.filter((n) => n.kind === 'account').map((n) => n.label + ':' + n.role).join(', ') + ')');
const E = g.edges.filter((e) => jd && (e.a === jd.id || e.b === jd.id));
ok(E.some((e) => e.t === 1 && e.p.b > 0 && /writes for Naples Daily News/.test(e.ev.byline || '')), 'web: tier-1 "writes for" link to the outlet');
ok(E.some((e) => (e.a + e.b).includes('bob roe') && /share a byline/.test(e.ev.byline || '')), 'web: co-author link');
ok(E.some((e) => (e.a + e.b).includes('tampabay.com') && e.p.m > 0), 'web: another outlet naming her is a mention');
ok(!g.nodes.some((n) => n.kind === 'entity' && /jane doe/i.test(n.label)), 'web: she is never a separate named thing');
const gw = await api('/api/graph?' + new URLSearchParams({ topic: t.id, kinds: 'account,entity', max: 80, role: 'writer' }));
ok(gw.nodes.some((n) => n.role === 'writer') && gw.nodes.some((n) => n.role === 'outlet') , 'web: Writers only shows writers with the outlets they write for');
const lst = await api('/api/writers?topic=' + t.id);
ok(lst.writers.map((w) => w.name).join(',') === 'Jane Doe,Bob Roe' && lst.writers[0].datelines[0].place === 'Naples, Fla.', 'writers list: ' + lst.writers.map((w) => w.name + ' ' + w.n).join(', '));
const d = await api('/api/writers/' + encodeURIComponent('jane doe') + '?topic=' + t.id);
ok(d.n === 2 && d.outlets[0].name === 'Naples Daily News' && d.coauthors[0].name === 'Bob Roe', 'dossier: 2 articles, outlet, co-author');
ok(d.coverage.map((c) => c.place).join(',') === 'Naples, Fla.,Fort Myers', 'dossier: datelines → files stories from (' + d.coverage.map((c) => c.place).join(', ') + ')');
ok(d.cited_by.some((c) => c.who === 'Tampa Bay Times'), 'dossier: named by Tampa Bay Times');
ok(d.page && d.page.handles.length === 2 && /covers the coast/.test(d.page.bio), 'dossier: author page handles + bio');
ok(d.names.some((n) => n.name === 'duke energy'), 'dossier: names in her articles');
// UI: topic dossier card → writer sheet → link a listed handle (your click)
await p.evaluate((h) => { location.hash = h; }, '#topic/' + t.id); await p.waitForTimeout(2500);
const card = await p.$('[data-writer="Jane Doe"]');
ok(!!card, 'dossier view: "Who writes about it" lists Jane Doe');
if (card) { await card.click(); await p.waitForTimeout(800); }
const sheet = await p.textContent('#sheet');
ok(/Writes for/.test(sheet) && /Naples Daily News/.test(sheet) && /Files stories from/.test(sheet) && /Naples, Fla\./.test(sheet) && /Shares bylines with/.test(sheet) && /Named by/.test(sheet), 'writer sheet: writes for · files from · co-authors · named by');
ok(/Nothing here was looked up about the person/.test(sheet), 'writer sheet: says what it is built from');
const h = await p.$('#sheet [data-handle="janedoe|x"]'); ok(!!h, 'writer sheet: the outlet-listed handle is offered as a tap-to-link');
if (h) { await h.click(); await p.waitForTimeout(1200); }
const ids = await api('/api/identities');
const I = (ids.identities || []).find((x) => x.name === 'Jane Doe');
ok(I && I.accounts.some((a) => a.id === 'janedoe|x') && I.accounts.some((a) => a.id === 'jane doe|press'), 'tap → identity "Jane Doe" ties the byline and @janedoe (x): ' + (I ? I.accounts.map((a) => a.id).join(', ') : 'none'));
ok(/Same person/.test(await p.textContent('#sheet')) && /◉ Jane Doe/.test(await p.textContent('#sheet')), 'writer sheet reopens with the person link shown');
// WEB view: writers filter and the HOW panel wording
await p.evaluate(() => { document.getElementById('sheetBg').click(); });
await p.evaluate((h) => { location.hash = h; }, '#network?topic=' + t.id + '&focus=' + encodeURIComponent('@Jane Doe') + '&role=writer'); await p.waitForTimeout(2500);
const why = await p.$('#nwWhy'); const whyText = why ? await p.textContent('#nwWhy') : '';
ok(!!why && /How @Jane Doe is connected/.test(whyText) && /writes for Naples Daily News/.test(whyText), 'web view: HOW panel says "writes for"');
ok(await p.evaluate(() => document.getElementById('nwRole').value === 'writer'), 'web view: deep link sets Writers only');
const gf = await api('/api/graph?' + new URLSearchParams({ topic: t.id, kinds: 'account,hashtag,word,entity', max: 80, focus: '"duke energy"', hops: 2 }));
ok(gf.focus === 'e:duke energy' && gf.nodes.some((n) => n.id === 'e:duke energy') && !gf.nodes.some((n) => n.id === 'w:duke energy'), 'web: centring on a name uses the diamond, no second word node (' + gf.focus + ')');
await p.evaluate((h) => { location.hash = h; }, '#network?topic=' + t.id + '&focus=' + encodeURIComponent('"duke energy"')); await p.waitForTimeout(2500);
ok(/How Duke Energy is connected/.test(await p.textContent('#nwWhy').catch(() => '')), 'web view: HOW panel is about the name itself');
ok(errs.length === 0, 'no page errors' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); srv.kill(); process.exit(bad ? 1 : 0);
