"""Build hub/hub-worker.js = ascii-render/og-worker.js (Social/ASCII routes) + reel-vault/worker/searchnet-worker.js
(SearchNet fetchers) + hub/build/hub-template.js (PTXERO ID, fair-use limits, per-person store, retention).
Run from anywhere:  python3 hub/build/gen_hub.py   then   node hub/build/test_hub.mjs
Re-run it whenever either source worker changes; never edit hub/hub-worker.js by hand."""
import re, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
og = (ROOT / 'ascii-render/og-worker.js').read_text()
sn = (ROOT / 'reel-vault/worker/searchnet-worker.js').read_text()
J = r'(?<![.\w])json\('          # the helper, never a .json() method call

sn_body = sn[sn.index('// ── helpers'):sn.index('// Node test shim')]
sn_body = sn_body.replace('function cors(res)', 'function snCors(res)').replace('function json(obj, status = 200)', 'function snJson(obj, status = 200)')
sn_body = re.sub(J, 'snJson(', sn_body)
sn_body = re.sub(r'(?<![.\w])cors\(', 'snCors(', sn_body)
sn_version = re.search(r'const VERSION = "([^"]+)"', sn).group(1)
sn_consts = '\n'.join(l for l in sn.splitlines() if l.startswith('const UA') or l.startswith('const INVIDIOUS'))
sn_routes = sn[sn.index('    const p = url.pathname.replace'):sn.index('    } catch (e) {\n      return json({ error: String(e && e.message || e) }, 502);')]
sn_routes = re.sub(J, 'snJson(', sn_routes)
sn_routes = re.sub(r'(?<![.\w])cors\(', 'snCors(', sn_routes)
sn_routes = sn_routes.replace('    try {\n', '', 1)
sn_routes = sn_routes.replace('secured: !!secret', 'secured: !!(env && env.SEARCHNET_SECRET)')
sn_routes = sn_routes.replace('version: VERSION,', 'version: SN_VERSION, hub: HUB_VERSION,')
sn_routes = sn_routes.replace('      return snJson({ error: "not found" }, 404);\n', '')

og_helpers = og[og.index('const esc ='):og.index('export default')]
og_helpers = og_helpers.replace("  const allowed = origin === ALLOWED_ORIGIN || origin.includes('localhost') || origin.includes('127.0.0.1');",
                                "  const allowed = ALLOWED.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1');")
og_helpers = og_helpers.replace("'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,", "'Access-Control-Allow-Origin': allowed ? origin : ALLOWED[0],")
og_helpers = og_helpers.replace("'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',", "'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',")
og_helpers = og_helpers.replace("'Access-Control-Allow-Headers': 'Content-Type',", "'Access-Control-Allow-Headers': 'Content-Type, X-PX-Uid, X-PX-Pub, X-PX-Ts, X-PX-Nonce, X-PX-Sig, X-SN-Key',")
og_helpers = og_helpers.replace('const json = (data, status, request)', 'const ogJson = (data, status, request)')
for must in ("ALLOWED.includes(origin)", "ogJson = (data", "X-PX-Sig"): assert must in og_helpers, must
og_routes = og[og.index('    // ── Service status'):og.rindex("    return json({ error: 'Not found' }, 404, request);")]
og_routes = re.sub(J, 'ogJson(', og_routes)
def rep(a, b, n=None):
    global og_routes
    c = og_routes.count(a); assert c and (n is None or c == n), (c, a[:70]); og_routes = og_routes.replace(a, b); return c
n1 = rep("        if (prof && prof.secret_hash) {\n          if (prof.secret_hash !== sh) return ogJson({ error: 'not authorized' }, 403, request);\n        } else {\n",
         "        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);\n        if (!(prof && (prof.secret_hash || prof.pubkey))) {\n")
n2 = rep("        if (prof && prof.secret_hash) {\n          if (prof.secret_hash !== sh) return ogJson({ error: 'not authorized' }, 403, request);\n        } else if (action === 'add') {\n",
         "        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);\n        if (!(prof && (prof.secret_hash || prof.pubkey)) && action === 'add') {\n", 1)
rep("        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(follower)}&select=secret_hash`, { headers: svc });\n        const prof = pr.ok ? (await pr.json())[0] : null;\n        if (!(await okIdentity(svc, uid, prof, sh, px)))",
    "        const pr = await fetch(`${SUPABASE}/rest/v1/profiles?uid=eq.${encodeURIComponent(follower)}&select=secret_hash,pubkey`, { headers: svc });\n        const prof = pr.ok ? (await pr.json())[0] : null;\n        if (!(await okIdentity(svc, follower, prof, sh, px)))", 1)
rep("        const existing = cur.ok ? (await cur.json())[0] : null;\n        const secretHash = await sha256hex(secret);\n        if (existing && existing.secret_hash && existing.secret_hash !== secretHash) {\n          return ogJson({ error: 'not authorized for this profile' }, 403, request);\n        }\n",
    "        const existing = cur.ok ? (await cur.json())[0] : null;\n        const secretHash = secret ? await sha256hex(secret) : '';\n        if (!(await okIdentity(svc, uid, existing, secretHash, px))) return ogJson({ error: 'not authorized for this profile' }, 403, request);\n", 1)
rep("        const body = { uid, secret_hash: secretHash, updated_at: new Date().toISOString() };", "        const body = Object.assign({ uid, updated_at: new Date().toISOString() }, secretHash ? { secret_hash: secretHash } : {});", 1)
rep("        if (!prof || !prof.secret_hash) return ogJson({ ok: true, unread: 0, items: [] }, 200, request);  // no identity yet\n        if (prof.secret_hash !== sh) return ogJson({ error: 'not authorized' }, 403, request);\n",
    "        if (!prof || !(prof.secret_hash || prof.pubkey)) return ogJson({ ok: true, unread: 0, items: [] }, 200, request);  // no identity yet\n        if (!(await okIdentity(svc, uid, prof, sh, px))) return ogJson({ error: 'not authorized' }, 403, request);\n", 1)
og_routes = og_routes.replace("profiles?uid=eq.${encodeURIComponent(uid)}&select=uid,secret_hash`", "profiles?uid=eq.${encodeURIComponent(uid)}&select=uid,secret_hash,pubkey`")
og_routes = og_routes.replace('&select=secret_hash`', '&select=secret_hash,pubkey`')
# the legacy secret becomes optional when the request is signed; the hash of an empty secret must not be used
og_routes = og_routes.replace("const sh  = await sha256hex(secret);", "const sh  = secret ? await sha256hex(secret) : '';").replace("const sh = await sha256hex(secret);", "const sh = secret ? await sha256hex(secret) : '';")
for a, b in [("if (!uid || !secret) return ogJson({ error: 'uid and secret required' }, 400, request);", "if (!uid || (!secret && !px.verified)) return ogJson({ error: 'uid and secret required' }, 400, request);"),
             ("if (!/^[A-Za-z0-9_-]+$/.test(slug) || !uid || !secret) return ogJson({ error: 'bad request' }, 400, request);", "if (!/^[A-Za-z0-9_-]+$/.test(slug) || !uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);"),
             ("if (!uid || !secret) return ogJson({ error: 'bad request' }, 400, request);", "if (!uid || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);"),
             ("if (!follower || !followee || !secret) return ogJson({ error: 'bad request' }, 400, request);", "if (!follower || !followee || (!secret && !px.verified)) return ogJson({ error: 'bad request' }, 400, request);"),
             ("if (!uid || !secret || !/^[A-Za-z0-9_-]+$/.test(target)) return ogJson({ error: 'bad request' }, 400, request);", "if (!uid || (!secret && !px.verified) || !/^[A-Za-z0-9_-]+$/.test(target)) return ogJson({ error: 'bad request' }, 400, request);")]:
    og_routes = og_routes.replace(a, b)
# TOFU registration rows: don't write an empty secret hash when a key did the proving
og_routes = og_routes.replace("body: JSON.stringify({ uid, secret_hash: sh, updated_at: new Date().toISOString() }) });", "body: JSON.stringify(Object.assign({ uid, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });")
og_routes = og_routes.replace("body: JSON.stringify({ uid: follower, secret_hash: sh, updated_at: new Date().toISOString() }) });", "body: JSON.stringify(Object.assign({ uid: follower, updated_at: new Date().toISOString() }, sh ? { secret_hash: sh } : {}, px.verified ? { pubkey: px.pub } : {})) });")
# admin override in /delete: a signed owner request is enough
og_routes = og_routes.replace("        if (!ok && ADMIN && secret && sfx(handle) === ADMIN) {", "        if (!ok && ADMIN && px.verified && px.uid === ADMIN) ok = true;\n        if (!ok && ADMIN && secret && sfx(handle) === ADMIN) {")
left = len(re.findall(r"secret_hash !== (sh|secretHash)", og_routes))
print('legacy checks rewritten:', n1, '+', n2, '· unguarded left:', left, '· .json() intact:', 'cur.json()' in og_routes)
assert left == 0 and 'cur.json()' in og_routes

tpl = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'hub/build/hub-template.js').read_text()
_c_old = "  const allowed = ALLOWED.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1');"
_c_new = "  const allowed = ALLOWED.includes('*') || ALLOWED.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')\n    || SN_PATHS.has(new URL(request.url).pathname.replace(/\\/+$/, '') || '/');   // compute-only routes: any site may use them"
assert og_helpers.count(_c_old) == 1, 'cors line'
og_helpers = og_helpers.replace(_c_old, _c_new)
hub = tpl.replace('@@SN_VERSION@@', sn_version).replace('@@SN_CONSTS@@', sn_consts).replace('@@OG_HELPERS@@', og_helpers).replace('@@SN_BODY@@', sn_body).replace('@@SN_ROUTES@@', sn_routes).replace('@@OG_ROUTES@@', og_routes)
(ROOT / 'hub/hub-worker.js').write_text(hub)
print('hub lines:', hub.count('\n'))
