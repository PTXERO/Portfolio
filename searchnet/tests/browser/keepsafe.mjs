// the library survives Safari's seven-day wipe: a weekly backup goes to the hub store on its own, and an empty device is offered it back
const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8773', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? '✓ ' : '✗ ') + m); };
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const NOW = Math.floor(Date.now() / 1000); const log = []; let stored = { _type: 'searchnet-backup', version: 1, made: NOW - 86400, topics: [{ id: 't1', name: 'Hurricane Isaias', seeds: ['isaias'], settings: {}, sources: [], created: NOW - 86400, counts: { pos: 0, neg: 0, unrated: 0 } }], votes: [], rel: [], kv: [] };
await ctx.route(/share\.ptxero\.net/, async (route) => {
  const req = route.request(); const u = new URL(req.url()); log.push(req.method() + ' ' + u.pathname);
  const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: JSON.stringify(o) });
  if (req.method() === 'OPTIONS') return json({});
  if (u.pathname === '/health') return json({ ok: true, worker: 'searchnet', version: '1.5', hub: '2.0' });
  if (u.pathname === '/me') return json({ uid: 'X', owner: false, today: { fetch: 0, writes: 0 }, limits: { fetch: 400, writes: 300 }, store: { bytes: 0, blobs: 0, by_app: {} } });
  if (u.pathname === '/id') return json({ ok: true });
  if (u.pathname === '/store/searchnet/backup' && req.method() === 'GET') return stored ? json({ app: 'searchnet', key: 'backup', data: stored }) : json({ error: 'not found' }, 404);
  if (u.pathname === '/store/searchnet/backup' && req.method() === 'PUT') { stored = JSON.parse(req.postData() || '{}'); return json({ ok: true, bytes: (req.postData() || '').length }); }
  if (u.pathname === '/search') return json({ items: [] });
  return json({ error: 'unmocked ' + u.pathname }, 404);
});
await ctx.route(/wikipedia|wikimedia|datamuse|googleapis|gstatic/, (r) => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:8773/searchnet/index.html?mode=browser#topics', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500);
const sheet = await p.textContent('#sheet').catch(() => '');
ok(/Restore your backup\?/.test(sheet) && /1 topics/.test(sheet), 'empty library + a backup on the hub → the restore is offered');
ok(/runs Worker 1\.5; this app expects/.test(await p.textContent('#banner')), 'an older hub is named in the banner with what is missing');
await p.click('#sheet button:has-text("RESTORE")').catch(() => {}); await p.waitForTimeout(1200);
const topics = (await p.evaluate(() => window.SearchNetLocal.request('/api/topics'))).topics || [];
ok(topics.some((t) => t.name === 'Hurricane Isaias'), 'restored topic is in the library');
// a week later: the backup goes up by itself
await p.evaluate(() => { localStorage.setItem('rv.lastBackup', JSON.stringify(1)); });
const puts0 = log.filter((l) => l === 'PUT /store/searchnet/backup').length;
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500);
ok(log.filter((l) => l === 'PUT /store/searchnet/backup').length > puts0 && (stored.topics || []).some((t) => t.name === 'Hurricane Isaias'), 'with the last backup over a week old, the library is backed up on its own');
await p.evaluate(() => { location.hash = '#sources'; }); await p.waitForTimeout(1200);
ok(/last backup .* automatic weekly/.test(await p.textContent('#bkMsg').catch(() => '')), 'SOURCES shows when the last backup was');
// a topic marked "this device only" is left out of the backup
const api = (path, opts) => p.evaluate(([path, opts]) => window.SearchNetLocal.request(path, opts), [path, opts]);
const t2 = await api('/api/topics', { method: 'POST', body: { name: 'Private thing', seeds: ['private thing'], settings: { visibility: 'device' }, run: false } });
const d = await p.evaluate(() => window.SearchNetLocal.backup());
ok(!(d.topics || []).some((t) => t.id === t2.id) && d.left_out === 1 && (d.topics || []).some((t) => t.name === 'Hurricane Isaias'), 'a "this device only" topic stays out of the backup (' + d.left_out + ' left out)');
await p.evaluate(() => { location.hash = '#topics'; }); await p.waitForTimeout(800);
ok(/this device only/.test(await p.textContent('#topicList').catch(() => '')), 'the topic card shows the lock');
ok(errs.length === 0, 'no page errors' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); srv.kill(); process.exit(bad ? 1 : 0);
