const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8768', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
const ok = (c, m) => console.log((c ? '✓ ' : '✗ ') + m);
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const NOW = Math.floor(Date.now() / 1000);
const post = (id, author, text, tags = '') => ({ id: 'mastodon:' + id, platform: 'mastodon', post_id: String(id), media: 'post', url: 'https://m.example/@' + author + '/' + id, author, author_name: author, text, hashtags: tags, posted_at: NOW - 86400 * id, likes: 1 });
const hubLog = [];
await ctx.route(/share\.ptxero\.net/, async (route) => {
  const req = route.request(); const u = new URL(req.url()); hubLog.push(req.method() + ' ' + u.pathname + u.search);
  const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' }, body: JSON.stringify(o) });
  if (req.method() === 'OPTIONS') return json({});
  if (u.pathname === '/health') return json({ ok: true, worker: 'searchnet', version: '1.4', hub: '2.0' });
  if (u.pathname === '/me') return json({ uid: 'X', owner: false, today: { fetch: 0, writes: 0 }, limits: { fetch: 400, writes: 300, store_bytes: 1 }, store: { bytes: 0, blobs: 0, by_app: {} }, retention_days: 180 });
  if (u.pathname === '/id') return json({ ok: true });
  if (u.pathname === '/search') {
    const src = u.searchParams.get('source');
    if (src === 'gdelt') return json({ error: 'api.gdeltproject.org → HTTP 403' }, 502);
    if (!['mastodon', 'news'].includes(src)) return json({ items: [] });
    if (src === 'news') return json({ items: [{ id: 'news:a1', platform: 'news', post_id: 'a1', media: 'post', url: 'https://www.tampabay.com/isaias-surge', author: 'Tampa Bay Times', author_name: 'Tampa Bay Times', text: 'Isaias storm surge hits Tampa Bay, Duke Energy reports outages', hashtags: '', posted_at: NOW - 3600 },
      { id: 'news:a2', platform: 'news', post_id: 'a2', media: 'post', url: 'https://www.tampabay.com/isaias-2', author: 'Tampa Bay Times', author_name: 'Tampa Bay Times', text: 'Isaias cleanup continues across Florida', hashtags: '', posted_at: NOW - 7200 },
      { id: 'news:a3', platform: 'news', post_id: 'a3', media: 'post', url: 'https://floridablog.example/isaias', author: 'floridablog.example', author_name: '', text: 'Hurricane Isaias from my porch', hashtags: '', posted_at: NOW - 10800 }] });
    return json({ items: [post(1, 'storm', 'Hurricane Isaias storm surge hits Tampa Bay as Duke Energy warns of outages #isaias #hurricane', 'isaias hurricane'), post(2, 'icewatch', 'ICE deportations in Florida continue this week #ice #deportation', 'ice deportation'), post(3, 'beach', 'florida beaches are nice today', '')] });
  }
  if (u.pathname === '/discover') return json({ url: u.searchParams.get('url'), host: 'floridablog.example', feeds: [{ url: 'https://floridablog.example/feed.xml', title: 'Florida Blog' }], search: 'https://floridablog.example/?s={q}' });
  return json({ error: 'unmocked ' + u.pathname }, 404);
});
await ctx.route(/wikipedia|wikimedia|datamuse|googleapis|gstatic/, (r) => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:8768/searchnet/index.html?mode=browser#sources', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const api = (path, opts) => p.evaluate(([path, opts]) => window.SearchNetLocal.request(path, opts), [path, opts]);
// sources: add News, keep mastodon
const presets = (await api('/api/sources/presets')).presets.map((x) => x.preset);
ok(['news', 'gdelt', 'web', 'obituaries', 'schools', 'blogs', 'hn', 'archive'].every((k) => presets.includes(k)), 'presets: news / gdelt / web / obituaries / schools / blogs / hn / archive offered');
const before = (await api('/api/sources')).sources; console.log('  default sources:', before.length);
ok(before.length >= 15 && before.every((x) => x.enabled) && ['news', 'web', 'fourchan', 'wikipedia', 'obituaries'].every((k) => before.some((x) => x.preset === k)), 'defaults: every built-in source exists and is on');
if (!before.some((x) => x.source === 'mastodon')) await api('/api/sources', { method: 'POST', body: { preset: 'mastodon', param: 'mastodon.social' } });
await api('/api/sources', { method: 'POST', body: { preset: 'news', param: 'Florida' } });
const obit = await api('/api/sources', { method: 'POST', body: { preset: 'obituaries' } });
ok(obit.param === 'qx' && /obituary/.test(obit.value), 'obituaries preset carries its extra terms');
await api('/api/sources/' + obit.id, { method: 'PATCH', body: { enabled: false } }).catch(() => {});
// planner: a name without PERSON still gets a person's sources; an event gets news + a 2-week window
const jt = await api('/api/topics', { method: 'POST', body: { name: 'John Smith', seeds: ['John Smith'], run: false } });
const byId = {}; (await api('/api/sources')).sources.forEach((s) => byId[s.id] = s.preset);
ok(jt.settings.plan.kind === 'person' && jt.sources.map((i) => byId[i]).includes('obituaries') && !jt.sources.map((i) => byId[i]).includes('fourchan'), 'plan: "John Smith" → person sources (obituaries in, 4chan out)');
// topic
const t = await api('/api/topics', { method: 'POST', body: { name: 'Florida Hurricane Isaias', seeds: ['florida hurricane isaias'], settings: { breadth: 1, media: 'everything' } } });
ok(t.settings.plan.kind === 'event' && t.settings.plan.window_days === 14 && !t.sources.map((i) => byId[i]).includes('obituaries'), 'plan: hurricane → event, last 14 days, no obituaries');
const j = await api('/api/topics/' + t.id + '/run', { method: 'POST' });
for (let i = 0; i < 60; i++) { const st = await p.evaluate((id) => (window.SearchNetLocal.jobs[id] || {}).state, j.id); if (st === 'done' || st === 'error') break; await p.waitForTimeout(300); }
ok(hubLog.some((l) => l.includes('source=news') && l.includes('qx=Florida')), 'run: news source queried with the extra term');
ok(hubLog.some((l) => l.includes('source=news') && /since=\d+/.test(l)), 'run: the time window rides along as since=');
const hn = (await api('/api/sources')).sources.find((x) => x.preset === 'gdelt');
ok(hn && !hn.enabled && hn.auto_off && /403/.test(hn.last_error), 'a failing source switched itself off with the reason (' + (hn && hn.last_error) + ')');
const hn2 = await api('/api/sources/' + hn.id, { method: 'PATCH', body: { enabled: true } });
ok(hn2.enabled && !hn2.auto_off && !hn2.last_error, 'flipping it back on clears the failure');
const T = await api('/api/topics/' + t.id);
const sites = (T.settings || {}).sites || {};
ok(sites['tampabay.com'] && sites['tampabay.com'].n === 2 && sites['floridablog.example'], 'run: sites tallied (' + Object.keys(sites).join(', ') + ')');
// the review deck explains itself
let feed = await api('/api/topics/' + t.id + '/feed?view=review&limit=20');
const ice = feed.items.find((it) => it.id === 'mastodon:2'), storm = feed.items.find((it) => it.id === 'mastodon:1');
if (!storm) console.log('  feed ids:', feed.items.map((i) => i.id).join(', '));
ok(storm && storm.why && storm.why.matched && storm.why.matched.length, 'why: the storm post lists what it matched (' + (storm && storm.why.matched || []).join(', ') + ')');
// votes: 👍 storm, 👎 ice (force a high prior score first so it counts as a surprise)
const yes = await api('/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: 'mastodon:1', label: 1 } });
await p.evaluate(async ([tid]) => { const L = window.SearchNetLocal; const v = await L.idb.get('votes', tid + '|mastodon:2'); v.score = 0.9; await L.idb.put('votes', v); }, [t.id]);
const no = await api('/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: 'mastodon:2', label: -1 } });
ok(no.surprise && no.surprise.terms.includes('#ice') && no.surprise.terms.some((w) => /deportation/.test(w)), '👎 on a confident post: asks why with its own words (' + (no.surprise ? no.surprise.terms.join(', ') : 'none') + ')');
await api('/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: 'mastodon:2', label: -1, reasons: ['#ice'] } });
await api('/api/topics/' + t.id + '/vote', { method: 'POST', body: { item_id: 'mastodon:1', label: 1, reasons: ['storm surge'] } });
const T2 = await api('/api/topics/' + t.id);
ok((T2.settings.soft || []).includes('storm surge') && (T2.settings.anti || []).includes('ice'), '👍 reason → soft keyword, 👎 reason → anti keyword');
// the web: 👎 account gone, unrelated low-score account gone, 👍 account present
const g = await api('/api/graph?' + new URLSearchParams({ topic: t.id, kinds: 'account,hashtag,word,entity', max: 80 }));
const duke = g.nodes.find((n) => n.kind === 'entity' && /duke energy/i.test(n.label));
ok(!!duke && g.edges.filter((e) => e.a === duke.id || e.b === duke.id).some((e) => (e.a + e.b).includes('|news')) && g.edges.filter((e) => e.a === duke.id || e.b === duke.id).some((e) => (e.a + e.b).includes('|mastodon')), 'web: "Duke Energy" links the outlet and the poster across sources');
ok(g.nodes.some((n) => n.kind === 'account' && n.role === 'outlet') && g.nodes.some((n) => n.kind === 'account' && n.role === 'person'), 'web: outlets and people carry roles');
const gp = await api('/api/graph?' + new URLSearchParams({ topic: t.id, kinds: 'account,entity', max: 80, role: 'person' }));
ok(!gp.nodes.some((n) => n.role === 'outlet') && gp.nodes.some((n) => n.role === 'person'), 'web: People only hides outlets');
const dukeEdges = g.edges.filter((e) => e.a === duke.id || e.b === duke.id);
ok(dukeEdges.every((e) => e.ev && e.ev.posts && e.ev.posts[0].url), 'web: every named link carries the post it comes from');
const tmin = {}; g.edges.forEach((e) => { tmin[e.a] = Math.min(tmin[e.a] || 9, e.t); tmin[e.b] = Math.min(tmin[e.b] || 9, e.t); });
ok(g.nodes.every((n) => n.id === g.focus || (tmin[n.id] || 9) <= 2), 'web: no node is left with only grey links');
// the WEB view explains the centred node's links
await p.evaluate((h) => { location.hash = h; }, '#network?topic=' + t.id + '&focus=' + encodeURIComponent('@storm')); await p.waitForTimeout(2500);
const why = await p.$('#nwWhy'); const whyText = why ? await p.textContent('#nwWhy') : '';
ok(!!why && /How @storm is connected/.test(whyText) && /named in|both name|uses the tag/.test(whyText), 'web view: HOW panel lists each link with its reason');
const accts = g.nodes.filter((n) => n.kind === 'account').map((n) => n.label);
ok(accts.includes('storm') && !accts.includes('icewatch'), 'web: 👎 account out, 👍 account in (' + accts.join(', ') + ')');
ok(!g.nodes.some((n) => n.kind === 'hashtag' && n.label === 'ice'), 'web: #ice gone with it');
const people = await api('/api/people?' + new URLSearchParams({ topic: t.id }));
ok(!(people.people || people).some((a) => a.author === 'icewatch'), 'people list: 👎 account out');
// dossier: sites card + one-tap source
await p.evaluate((h) => { location.hash = h; }, '#topic/' + t.id); await p.waitForTimeout(2500);
ok(await p.$('[data-site="floridablog.example"]') !== null, 'dossier: opening a topic lands on the dossier, SITES card offers + SOURCE');
await p.click('[data-site="floridablog.example"]'); await p.waitForTimeout(1200);
const srcs = (await api('/api/sources')).sources.map((s) => s.name);
ok(srcs.some((n) => /Florida Blog · feed/.test(n)) && srcs.some((n) => /floridablog.example · search/.test(n)), 'dossier: + SOURCE added the feed and the search page (' + srcs.filter((n) => /florida/i.test(n)).join(' | ') + ')');
// brief
const br = await api('/api/topics/' + t.id + '/brief');
ok(br.sentences.length >= 1 && /\[\d+\]/.test(br.prompt) && br.citations[1], 'brief: sentences with citations and an LLM packet (' + br.sentences.length + ' sentences)');
await p.evaluate((h) => { location.hash = h; }, '#topic/' + t.id + '/dossier'); await p.waitForTimeout(2000);
ok(await p.$('#brAi') !== null && await p.$('#plEdit') !== null, 'dossier: BRIEF and SOURCES cards render');
// a name typed in the form offers the dossier
await p.evaluate(() => { location.hash = '#topics'; }); await p.waitForTimeout(800);
await p.fill('#ntName', 'Jane Doe'); await p.evaluate(() => document.getElementById('newTopicForm').requestSubmit()); await p.waitForTimeout(600);
ok(/Looks like a person/.test(await p.textContent('#sheet')) && (await p.textContent('#cYes')).trim() === 'DOSSIER', 'form: a typed name asks dossier or topic');
await p.click('#cNo'); await p.waitForTimeout(1500);
const jd = (await api('/api/topics')).topics.find((x) => x.name === 'Jane Doe');
ok(jd && jd.settings.plan.kind === 'person' && !jd.settings.person, 'form: choosing TOPIC keeps a plain topic with person sources');
// review UI: why line + surprise bar visible
await p.evaluate((h) => { location.hash = h; }, '#topic/' + t.id + '/review'); await p.waitForTimeout(1500);
ok(await p.evaluate(() => !!document.querySelector('.rcard .whynot')), 'review card shows a why line');
ok(errs.length === 0, 'no page errors' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); srv.kill();
