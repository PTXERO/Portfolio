// Asks the live hub for one search per source and fails when a source that should work comes back empty or
// broken. Run by .github/workflows/hub-live-check.yml every week, or by hand: node hub/build/live_check.mjs
const HUB = process.env.HUB || 'https://share.ptxero.net';
const checks = [['news', 'hurricane'], ['gdelt', '"hurricane"'], ['web', 'hurricane season'], ['hn', 'hurricane'], ['archive', 'hurricane'],
  ['wikipedia', 'hurricane'], ['fourchan', 'hurricane'], ['mastodon', 'hurricane'], ['lemmy', 'hurricane'], ['reddit', 'hurricane'], ['bluesky', 'hurricane'], ['youtube', 'hurricane']];
const soft = new Set(['reddit', 'bluesky', 'gdelt']);   // known to refuse or rate-limit shared addresses: reported, not fatal
let bad = 0;
const h = await (await fetch(HUB + '/health')).json().catch(() => ({}));
console.log('hub', h.hub, 'searchnet', h.version);
for (const [source, q] of checks) {
  const r = await fetch(`${HUB}/search?source=${source}&q=${encodeURIComponent(q)}&limit=5&media=everything`).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  const n = (j.items || []).length; const okc = n > 0;
  console.log((okc ? '✓' : soft.has(source) ? '~' : '✗') + ' ' + source.padEnd(10) + (okc ? n + ' items' : (j.error || 'empty')));
  if (!okc && !soft.has(source)) bad++;
}
if (bad) { console.log(bad + ' source(s) broken'); process.exit(1); }
