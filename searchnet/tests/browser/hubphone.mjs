const pw = (await import(process.env.PW_MODULE || 'playwright')).default; const ROOT = new URL('../../..', import.meta.url).pathname;
import { spawn } from 'node:child_process';
const srv = spawn('python3', ['-m', 'http.server', '8771', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ ...pw.devices['iPhone 14 Pro'] });
await ctx.route(/share\.ptxero\.net|fonts\./, (r) => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
for (const tab of ['', '#setup', '#limits', '#api']) {
  await p.goto('http://127.0.0.1:8771/hub/' + tab, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(600);
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, document.querySelector('.pane.on').id]);
  console.log(tab || '#you', 'scrollWidth', w[0], 'inner', w[1], w[0] <= w[1] ? '✓ fits' : '✗ overflows', w[2]);
  await p.screenshot({ path: '/tmp/hub' + (tab.slice(1) || 'you') + '.png' });
}
await p.goto('http://127.0.0.1:8771/hub/#setup', { waitUntil: 'domcontentloaded' }); await p.click('.steps details:nth-child(5) summary'); await p.waitForTimeout(300);
const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); console.log('step 5 open', w[0] <= w[1] ? '✓ fits' : '✗ overflows ' + w[0]);
await p.screenshot({ path: '/tmp/hubstep5.png' });
console.log('errors', errs);
await browser.close(); srv.kill();
