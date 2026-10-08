// posts are strangers' text: a script in one must render as text everywhere (review, library, dossier, web, profile)
const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8775', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? '✓ ' : '✗ ') + m); };
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const NOW = Math.floor(Date.now() / 1000);
const EVIL = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>"><svg onload=window.__pwned=3>';
const post = (id, author, text, extra = {}) => Object.assign({ id: 'mastodon:' + id, platform: 'mastodon', post_id: String(id), media: 'post', url: 'https://m.example/@' + encodeURIComponent(author) + '/' + id, author, author_name: author, text, hashtags: 'isaias ' + EVIL, posted_at: NOW - 3600 * id, likes: 5, reposts: 1, replies: 0, views: 0 }, extra);
await ctx.route(/share\.ptxero\.net/, async (route) => {
  const u = new URL(route.request().url()); const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(o) });
  if (route.request().method() === 'OPTIONS') return json({});
  if (u.pathname === '/health') return json({ ok: true, worker: 'searchnet', version: '1.9', hub: '2.0' });
  if (u.pathname === '/me') return json({ uid: 'X', owner: false, today: { fetch: 0, writes: 0 }, limits: { fetch: 400, writes: 300 }, store: { bytes: 0, blobs: 0, by_app: {} } });
  if (u.pathname === '/id') return json({ ok: true });
  if (u.pathname === '/topics') return json({ topics: [{ id: 'evil1', name: EVIL, seeds: [EVIL], kind: 'general', started_by: EVIL, people: 1, ratings: 0 }] });
  if (u.pathname === '/search') return json({ items: u.searchParams.get('source') === 'mastodon' ? [post(1, 'storm' + EVIL, 'Isaias surge ' + EVIL + ' #isaias', { author_url: 'javascript:window.__pwned=4', thumbnail: 'javascript:window.__pwned=5' }), post(2, 'cleanup', 'Isaias cleanup, said Duke Energy ' + EVIL + ' on Friday'), post(3, 'third', 'Isaias: 200 customers without power ' + EVIL)] : [] });
  return json({ error: 'not found' }, 404);
});
await ctx.route(/wikipedia|wikimedia|datamuse|googleapis|gstatic/, (r) => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:8775/searchnet/index.html?mode=browser#topics', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
const api = (path, opts) => p.evaluate(([path, opts]) => window.SearchNetLocal.request(path, opts), [path, opts]);
if (!(await api('/api/sources')).sources.some((x) => x.source === 'mastodon')) await api('/api/sources', { method: 'POST', body: { preset: 'mastodon', param: 'mastodon.social' } });
const t = await api('/api/topics', { method: 'POST', body: { name: 'Isaias ' + EVIL, seeds: ['isaias'], settings: { window: 'all', media: 'everything' }, run: false } });
const j = await api('/api/topics/' + t.id + '/run', { method: 'POST' }); for (let i = 0; i < 60; i++) { const st = await p.evaluate((id) => (window.SearchNetLocal.jobs[id] || {}).state, j.id); if (st === 'done' || st === 'error') break; await p.waitForTimeout(300); }
for (const id of ['mastodon:1', 'mastodon:3']) await api('/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: id, label: 1 } });
const pwned = () => p.evaluate(() => window.__pwned);
const views = ['#topics', '#topic/' + t.id + '/review', '#topic/' + t.id, '#library', '#network?topic=' + t.id, '#network?topic=' + t.id + '&focus=' + encodeURIComponent('@storm' + EVIL), '#sources', '#activity'];
for (const v of views) { await p.evaluate((h) => { location.hash = h; }, v); await p.waitForTimeout(v.includes('#topic/') && !v.includes('review') ? 3000 : 1500); const html = await p.evaluate(() => document.body.innerHTML);
  const raw = (html.match(/<img src=x onerror|<script>window\.__pwned|<svg onload/g) || []).length; ok((await pwned()) === undefined && raw === 0, v.replace(t.id, 'T').slice(0, 40) + ': nothing ran, markup is text' + ((await pwned()) !== undefined ? ' · pwned=' + (await pwned()) : '') + (raw ? ' · raw tags: ' + raw : '')); }
await p.evaluate((h) => { location.hash = h; }, '#topic/' + t.id + '/review'); await p.waitForTimeout(1500);
await p.evaluate(() => { const b = document.querySelector('[data-prof], .rcard [data-open], .rcard a.lnk'); if (b) b.click(); }); await p.waitForTimeout(1200);
ok((await pwned()) === undefined, 'profile sheet: nothing ran');
const hrefs = await p.evaluate(() => [...document.querySelectorAll('a[href^="javascript:"], img[src^="javascript:"]')].length);
ok(hrefs === 0 && (await pwned()) === undefined, 'no javascript: links or images survive (' + hrefs + ')');
ok(errs.length === 0, 'no page errors' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); srv.kill(); process.exit(bad ? 1 : 0);
