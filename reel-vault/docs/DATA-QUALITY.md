# SEARCH//NET · data-quality review and remediation plan

Scope: looking a person up by one handle on one network (worked example: `@CloneStoo` on X) and
building outward. This lists every way the result can mislead, what is already fixed, and what is
planned — so the tool says what it knows, says what it doesn't, and never invents a link.

Legend · **DONE** shipped · **NEXT** small, this week · **PLAN** needs design or a new data source ·
**LIMIT** a property of the network we can only label, not fix.

---

## 1. Identity — is this the right account?

| # | Problem | Status | Mitigation / remediation |
|---|---|---|---|
| 1.1 | Handle renames and reuse: old mentions of `@x` may be a previous owner | LIMIT → PLAN | Store `first_seen` / `last_seen` per account and show the span on the profile; when a handle's user-id is known (X `rest_id`, Mastodon `id`, Bluesky `did`), key the account by that id and show "handle changed" when the same id appears under a new handle. |
| 1.2 | Impersonators / look-alike handles | PLAN | Look-alike flag: Levenshtein ≤ 1, confusable glyphs (`l/1/I`, `0/O`), trailing `_`/digits → show "⚠ similar to @…" on cards and in the web hover; never merge. |
| 1.3 | Case splits (`CloneStoo` vs `clonestoo` became two accounts) | **DONE** | Account ids are lower-cased in both engines; display keeps the first spelling seen. |
| 1.4 | Cross-platform name collision (`@clonestoo` on Mastodon drawn as a real link to the X account) | **DONE** | Mention matching and the pairwise model are platform-scoped. A cross-network link now needs a URL the person posted, a follow list, or your own hand link. |
| 1.5 | Display name vs handle keyed separately | NEXT | Profile header shows `display name · @handle · network`; BY NAME dossiers suggest "same person?" only when a known account's display name equals the dossier name — as a prompt, never automatic. |
| 1.6 | Protected / suspended / deleted account looks like "0 posts" | NEXT | Surface the fetcher's reason (`AuthRequired`, `Protected`, `NotFound`, `Suspended`) as a status pill on the PERSON card, not only in the job log. |

## 2. Scope — which posts are we seeing?

| # | Problem | Status | Mitigation / remediation |
|---|---|---|---|
| 2.1 | Media only (text tweets invisible) | NEXT | Person topics default to `media: everything`; add a timeline source (`x.com/<h>` not `/media`, `with_replies` where available) and label every count "media posts" vs "posts". |
| 2.2 | Replies excluded → tagging undercounted | NEXT | For person topics drop `-filter:replies` and collect the `with_replies` timeline; show "replies: on/off" on the card. |
| 2.3 | Retweets / quotes attributed to other authors | NEXT | Keep `retweeted_by` / `quoted_by` from the fetcher; mark items `kind: repost`, exclude them from "Who talks about it most" and show them as a dashed grey "shared" link instead. |
| 2.4 | One tweet with 4 images counted as 4 posts | **DONE** | Counts use distinct posts (`post_id` or the id stem); grids still show every attachment. |
| 2.5 | Search window / timeline cap | LIMIT → NEXT | Show the collected date range ("posts from 2023-04 → now, N fetched, cap 3,200") under the trend chart so the curve is read as *what we fetched*. |
| 2.6 | Deleted tweets persist | PLAN | Periodic liveness check for person topics (HEAD the post URL); mark `gone` and show it struck through with the date last seen. |
| 2.7 | No profile fields (bio, location, join date, website, follower counts) | PLAN | Fetch the public profile where an endpoint exists (Mastodon `/accounts/lookup`, Bluesky `getProfile`, X via gallery-dl `user` info, YouTube `about` page) and show a **PROFILE FIELDS** block with the source and timestamp; bio links feed "Linked elsewhere". |

## 3. Graph artifacts

| # | Problem | Status | Mitigation / remediation |
|---|---|---|---|
| 3.1 | No follow data on X | LIMIT | Label the gap: "X publishes no follow list; links here are mentions only." (already on the card); never infer follows. |
| 3.2 | `@name` inside URLs parsed as a mention | **DONE** | URLs are stripped before mention extraction in both engines. |
| 3.3 | Mention direction lost in the web | NEXT | Store direction on the edge (`p.m_out`, `p.m_in`); hover shows "they tag → / ← tagged by / ⇄"; 2-D draws a small arrowhead on tier-1 lines. |
| 3.4 | Hop = any pulling link, so tags count as closeness | NEXT | HOPS button gets a second toggle "via: real links only / real + tags"; default to real-only when the focus is an account. |
| 3.5 | Community names = top hashtag | NEXT | Name a community by its top *account* when it has one, else top tag; show "named after" in the legend tooltip. |
| 3.6 | INFLUENCE is betweenness within your sample | NEXT | Rename the button to BRIDGES and say so in the hint; keep the metric. |
| 3.7 | Grey lines read as relationships | NEXT | Add a strip toggle "hide shared-word lines"; default hidden when a person is focused. |
| 3.8 | Pull weights differ per user | DONE / NEXT | Weights are shown in the hint; add "(default)" marker and a one-click reset in the WEIGHTS panel (exists) — and print the active weights in any exported view. |

## 4. External enrichments

| # | Problem | Status | Mitigation / remediation |
|---|---|---|---|
| 4.1 | Wikipedia article / pageviews for the wrong person | **DONE** | No Wikipedia lookup or pageview chart on person topics. |
| 4.2 | Handle guesses are unverified permutations | NEXT | Label the table "unverified guesses"; verify on networks with a public lookup (Mastodon, Bluesky, Reddit, YouTube) and show ✓ exists / ✕ no such account / ? unknown. |
| 4.3 | People-search links return many people | LIMIT | Keep links only; add the state and middle initial to the query when known; never fetch or store results. |

## 5. Environment and collection

| # | Problem | Status | Mitigation / remediation |
|---|---|---|---|
| 5.1 | Your own X login shapes search results | LIMIT → NEXT | Record which cookie/account each run used (`collected_via`) and show it in the job log and on the dossier footer. |
| 5.2 | Browser cookie lock → silent emptiness | **DONE** (log) → NEXT | Also raise it on the PERSON card as a red status pill with the fix. |
| 5.3 | Rate limits / partial feeds look complete | NEXT | Jobs record `truncated: true` with the reason; counts show "≥ N (fetch stopped early)". |
| 5.4 | Browser mode cannot read X | DONE (message) | Keep; link straight to the PC-server setup from the message. |
| 5.5 | Two libraries (browser vs PC) | PLAN | Optional sync (Supabase, task #17) or an export/import of the library; until then the dossier footer names the library it was built from. |
| 5.6 | Snapshot metrics (likes/views never refreshed) | NEXT | Show "as of <collected date>" next to ♥ / views; a REFRESH METRICS action on a profile re-reads their recent posts. |
| 5.7 | Times shown in UTC | NEXT | Setting: UTC / my time zone / account's declared time zone (when a profile field exists); default to my time zone with the label. |

## 6. Learning-model effects

| # | Problem | Status | Mitigation / remediation |
|---|---|---|---|
| 6.1 | BEST / scores re-rank a person's posts by your votes | NEXT | On person topics default REVIEW to chronological and hide BEST; keep votes for teaching only when the user turns ranking on. |
| 6.2 | Strict mode means mentions *of* the person by others are not collected | DONE (by design) → NEXT | Add an explicit, off-by-default "also collect posts that tag @handle" switch on the PERSON card, so the choice is visible. |

## 7. Presentation ambiguities

| # | Problem | Status | Mitigation / remediation |
|---|---|---|---|
| 7.1 | "posts" meant attachments | **DONE** | Distinct posts everywhere; `items_n` kept for the grid. |
| 7.2 | "last 2.9y" = newest collected item | NEXT | Tooltip "newest post we fetched"; show the fetch date range (2.5). |
| 7.3 | "N accounts" includes quoted authors | NEXT (with 2.3) | Exclude reposts from account counts. |
| 7.4 | "pull" has no unit | NEXT | Hover shows the breakdown ("mentions 3 · tags 1.2 · words 0") instead of one number. |
| 7.5 | ↗ ↙ = 0 on X reads as "follows nobody" | NEXT | Show "–" with tooltip "no public follow list on X" instead of 0. |

---

## Order of work

1. **Shipped now:** 1.3, 1.4, 2.4, 3.2, 4.1, 7.1.
2. **Next (small, UI + fetcher flags):** 1.6, 2.1, 2.2, 2.5, 3.3, 3.4, 3.6, 3.7, 4.2, 5.2, 5.3, 5.6, 5.7, 6.1, 6.2, 7.2, 7.4, 7.5.
3. **Needs a data model change:** 1.1 (stable ids), 2.3 (repost provenance), 2.7 (profile fields), 3.5.
4. **Needs a new service:** 2.6 (liveness), 5.5 (sync / export).

## Principles these follow

- A link is drawn only from evidence the person or the platform produced (follow list, mention in
  their own post, URL they posted) — never from a name match across networks.
- Every number names its basis (posts vs media, fetched range, as-of date, which login).
- Absence is labelled ("no public follow list"), not shown as zero.
- Nothing sensitive is inferred; people-search sites are links the user opens, never fetched.
