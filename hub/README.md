# PTXERO HUB

One Cloudflare Worker that serves every PTXERO app:

| Routes | From | For |
|---|---|---|
| `/search /account /follows /resolve /fetch /health` | `searchnet/worker/searchnet-worker.js` | SEARCH//NET fetching (browser mode) |
| `/profile /post /like /comment /follow /repost /report /delete /share /r/ /p/ /status /presence /notifications` | `ascii-render/og-worker.js` | SOCIAL, ASCII//RENDER, RF presence |
| `/id /me /me/export /store/*` + fair-use limits + retention cron | `hub/build/hub-template.js` | PTXERO ID, per-person data, auto-deletion |

`hub/hub-worker.js` is **generated**. Never edit it by hand:

```sh
python3 hub/build/gen_hub.py        # merges the three sources → hub/hub-worker.js
node hub/build/test_hub.mjs         # end-to-end against a fake Supabase (identity, quotas, store, legacy migration, cron)
```

Re-run both whenever `searchnet-worker.js`, `og-worker.js` or the template changes.

## How identity works

`ptxero-id.js` (site root) gives every page `window.PX`: the same `@PREFIX-SUFFIX` handle Social always had, backed by an ECDSA P-256 keypair made in the browser. Writes are signed (`X-PX-Uid/Pub/Ts/Nonce/Sig` over `uid\nts\nnonce\nMETHOD\npath`). The hub binds the first key it sees for a handle (`profiles.pubkey`) and rejects every other key. A valid signature alone is not enough, `ownsId()` checks the binding. Pre-key Social profiles (`secret_hash`) migrate when they present the old secret once alongside a signature.

Fair use is counted per identity per UTC day via the `hub_touch` RPC (`hub_usage`); anonymous callers are counted per IP with a smaller fetch allowance; `ADMIN_UID` is exempt. A forged uid that doesn't own the key is counted as anonymous, never against the real person. Retention: the cron purges identities whose `hub_users.last_seen` is older than `RETENTION_DAYS` (default 180) unless `pinned`, using the same `purgeUser()` that `DELETE /me` runs.

## Deploying the shared hub (owner)

1. Supabase → SQL Editor → run `hub/hub-setup.sql` (idempotent; on the existing project it only adds the `pubkey`/`featured`… columns, the `hub_*` tables and the RPCs).
2. Cloudflare → the Worker behind `share.ptxero.net` → Edit code → paste `hub/hub-worker.js` → Deploy.
3. Settings → Variables and Secrets: `SERVICE_KEY` (secret, already there), `SUPABASE_URL`, `ADMIN_UID` = your suffix. Optional: `ALLOWED_ORIGINS`, `LIMITS`, `RETENTION_DAYS`, `BUCKET`, `SEARCHNET_SECRET`.
4. Settings → Triggers → Cron Triggers → `0 4 * * *`.
5. `/health` must now answer with `"hub":"2.0"`; the guide page's TEST box does a signed `/me` too.

Until step 2 is done the apps still work: the old Worker answers the Social/ASCII routes, SearchNet's fetch routes return "not found" on it, and the YOUR DATA panel says the hub is older.

## Deploying without pasting

`.github/workflows/hub-worker.yml` pushes `hub/hub-worker.js` to Cloudflare on every change to `main`. Set the
two repository secrets it names (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and put the existing Worker's
name in `hub/wrangler.toml`. `.github/workflows/hub-live-check.yml` asks the live hub for one search per source
every Monday and fails when a source that should work comes back empty.

## For people running their own hub

`hub/index.html` is the published guide (Supabase project → SQL → Worker → secrets → cron → TEST → point the apps). The apps pick the hub up from `PX.host()` (`localStorage.ptxero_host`), which the key file also carries.
