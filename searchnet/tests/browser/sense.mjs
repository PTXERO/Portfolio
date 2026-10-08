// an ambiguous name: the dossier asks which one, the pick becomes soft keywords; SOURCES rows say how each source is doing
const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8776', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? '✓ ' : '✗ ') + m); };
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const NOW = Math.floor(Date.now() / 1000);
const post = (id, author, text) => ({ id: 'mastodon:' + id, platform: 'mastodon', post_id: String(id), media: 'post', url: 'https://m.example/@' + author + '/' + id, author, author_name: author, text, hashtags: 'furnace', posted_at: NOW - 3600 * id, likes: 2, reposts: 0, replies: 0, views: 0 });
await ctx.route(/share\.ptxero\.net/, async (route) => {
  const u = new URL(route.request().url()); const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(o) });
  if (route.request().method() === 'OPTIONS') return json({});
  if (u.pathname === '/health') return json({ ok: true, worker: 'searchnet', version: '1.9', hub: '2.0' });
  if (u.pathname === '/me') return json({ uid: 'X', owner: false, today: { fetch: 0, writes: 0 }, limits: { fetch: 400, writes: 300 }, store: { bytes: 0, blobs: 0, by_app: {} } });
  if (u.pathname === '/id') return json({ ok: true });
  if (u.pathname === '/topics') return json({ topics: [] });
  if (u.pathname === '/search') { const src = u.searchParams.get('source'); if (src === 'gdelt') return json({ error: 'api.gdeltproject.org → HTTP 403' }, 502); return json({ items: src === 'mastodon' ? [post(1, 'fan', 'Furnace Fest at Sloss this weekend #furnace'), post(2, 'chip', 'Furnace tracker chiptune #furnace')] : [] }); }
  return json({ error: 'not found' }, 404);
});
await ctx.route(/wikipedia\.org/, async (route) => {
  const u = new URL(route.request().url()); const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
  if (/page\/summary\/furnace$/i.test(u.pathname)) return json({ type: 'disambiguation', title: 'Furnace', extract: 'Furnace may refer to:' });
  if (/page\/summary\/Furnace_Fest/i.test(u.pathname)) return json({ type: 'standard', title: 'Furnace Fest', extract: 'Furnace Fest is a hardcore and metal music festival held at Sloss Furnaces in Birmingham, Alabama.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Furnace_Fest' } } });
  if (u.pathname.endsWith('/w/api.php')) return json(['furnace', ['Furnace Fest', 'Furnace (software)', 'Blast furnace'], ['', '', ''], ['https://en.wikipedia.org/wiki/Furnace_Fest', 'https://en.wikipedia.org/wiki/Furnace_(software)', 'https://en.wikipedia.org/wiki/Blast_furnace']]);
  return route.abort();
});
await ctx.route(/wikimedia|datamuse|googleapis|gstatic/, (r) => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:8776/searchnet/index.html?mode=browser#topics', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
const api = (path, opts) => p.evaluate(([path, opts]) => window.SearchNetLocal.request(path, opts), [path, opts]);
if (!(await api('/api/sources')).sources.some((x) => x.source === 'mastodon')) await api('/api/sources', { method: 'POST', body: { preset: 'mastodon', param: 'mastodon.social' } });
const t = await api('/api/topics', { method: 'POST', body: { name: 'furnace', seeds: ['furnace'], settings: { window: 'all', media: 'everything' }, run: false } });
const j = await api('/api/topics/' + t.id + '/run', { method: 'POST' }); for (let i = 0; i < 60; i++) { const st = await p.evaluate((id) => (window.SearchNetLocal.jobs[id] || {}).state, j.id); if (st === 'done' || st === 'error') break; await p.waitForTimeout(300); }
await p.evaluate((h) => { location.hash = h; }, '#topic/' + t.id); await p.waitForTimeout(3000);
let body = await p.textContent('#tBody');
ok(/Which one\?/.test(body) && /Furnace Fest/.test(body) && /Blast furnace/.test(body), 'an ambiguous seed asks which one, with Wikipedia\'s options');
await p.click('[data-sense="Furnace Fest"]'); await p.waitForTimeout(3000);
const T = await api('/api/topics/' + t.id);
ok(T.settings.sense === 'Furnace Fest' && (T.settings.soft || []).some((w) => /festival|hardcore|birmingham|sloss/.test(w)), 'the pick is remembered and its words are soft keywords (' + (T.settings.soft || []).join(', ') + ')');
body = await p.textContent('#tBody'); ok(!/Which one\?/.test(body) && /Sloss Furnaces/.test(body), 'the dossier now shows the chosen article');
await p.evaluate((h) => { location.hash = h; }, '#sources'); await p.waitForTimeout(1500);
const srcText = (await p.textContent('#srcList')).replace(/\s+/g, ' ');
ok(/worked .* ago/.test(srcText), 'a source that answered says when it last worked');
ok(/1 of 3 failing runs/.test(srcText), 'a source that failed says how many strikes it has');
ok(errs.length === 0, 'no page errors' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); srv.kill(); process.exit(bad ? 1 : 0);
