# SEARCH//NET · data-quality review and remediation plan

Scope: looking a person up by one handle on one network (worked example: `@johnsmith` on X) and
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
| 1.3 | Case splits (`JohnSmith` vs `johnsmith` became two accounts) | **DONE** | Account ids are lower-cased in both engines; display keeps the first spelling seen. |
| 1.4 | Cross-platform name collision (`@johnsmith` on Mastodon drawn as a real link to the X account) | **DONE** | Mention matching and the pairwise model are platform-scoped. A cross-network link now needs a URL the person posted, a follow list, or your own hand link. |
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


## Update: what is "in" a topic, and why

- The web, the people list and the dossier only show what is **in** the topic: 👍 always, 👎 never,
  unrated only when its score clears the bar (halfway between what you liked and what you didn't once
  both have a few votes, else 0.5) and no anti keyword hits. A 👎 post, its account and its tags drop
  out of the web immediately. The REVIEW deck still shows everything found, that is its job.
- Every card says why it scores what it does: what it matched, which of its words look like your 👍,
  which look like your 👎, and any anti keyword hit. A post that only a search engine returned, with
  nothing in the text matching, says so.
- A vote the model did not expect (👍 under 35%, 👎 over 65%) asks why and offers the post's own words
  as chips. 👎 reasons become anti keywords, 👍 reasons become soft keywords. Ignoring it is fine, the
  vote still trains the model.
- Known limits: generic grown queries ("florida") still pull unrelated posts into REVIEW; pruning
  queries by precision is the next step. Scores are per topic, so the same post can be in one topic
  and out of another.

- Sources: every built-in source is on from the start (Mastodon, Lemmy, Reddit, Bluesky, YouTube, News,
  GDELT, the web, Obituaries, Schools, Blogs, Hacker News, Internet Archive, 4chan, Wikipedia; X on the
  PC server). A source that errors switches itself off and says why in SOURCES; the switch turns it back
  on. Quota waits and the hub being down do not count as failures.
- Harvest gaps closed: Bing paged up to 200 results, GDELT searched back to 2017, one retry on 5xx,
  canonical URLs so the same article is one item, Reddit through PullPush when reddit.com refuses the
  Worker, verified search-page discovery (OpenSearch, platform fingerprints, forms, common paths, each
  candidate tested with a real query).
- Still open: X and Instagram need the PC server with cookies. Bluesky refuses some Cloudflare addresses.
  4plebs blocks API use; desuarchive and live catalogs cover 4chan. Google News caps at ~100 per query;
  time windows (before:/after:) per query are the next step for deep history.

## Update: the topic plans itself
- When a topic is created the words decide what it is (a person, an @account, an event, a place,
  something technical, or general) and which sources fit. The dossier shows the reading and the
  reason; EDIT SOURCES overrides it (then the plan stops touching the list), PICK AGAIN hands it back.
- A typed name without PERSON asks: dossier or plain topic. Either way the person sources are used.
- Time window: events default to the last 14 days, places 90, the rest everything. You can set
  Live / 2 weeks / month / year / everything per topic. It is pushed into Google News (when:/after:),
  GDELT, Hacker News, and applied to every other source's dated results. Older posts you 👍 stay.
- After each run a source that found nothing three runs in a row, or whose finds are 85 % 👎 after six
  votes, is dropped from the topic with the reason shown.
- BRIEF in the dossier: the sentences that carry the topic's words, who and where, a timeline, each with
  [n] back to the post. No model needed. SUMMARIZE WITH AN LLM sends the same numbered posts to your own
  Anthropic or OpenAI key from this browser, or Ollama on your computer. The hub never sees any of it.

## Update: real links in the web
- Named things (people, places, organisations written in posts: "Duke Energy", "Ocean Isle Beach") are
  nodes now (◆). An outlet's article and a Mastodon post that both name the same thing are linked through
  it. That is the one cross-source link articles offer, and it is drawn and weighted (pull 4) like a mention.
- Outlets (news, web, archive, Wikipedia) are marked as outlets, drawn as hexagons, and can be hidden with
  "People only" in the WEB toolbar. The dossier lists "Named in the posts" and "Outlets covering it"
  separately from people.
- Internet Archive uploads no longer carry their media type as a hashtag (that is what glued unrelated TV
  stations into a #movies community).
- Topics open on the dossier.

## Update: the shortfall list
- Links explain themselves: hover a link or centre a node. Every link carries where it came from (the post),
  how (mention, follow and its direction, shared name, shared tag) and the words when that is all there is.
  Nodes with only shared-word links are gone unless you centred on a word.
- Articles are read in full after a run (up to 25 per run on the PC, 15 in the browser), so names, scores and
  the brief work from the body, not the headline. The same page from two engines is one item.
- A run stops at 60 fetches on the shared hub (150 on your own), grown searches rated 👎 three times in four
  are switched off, a source that switched itself off is retried a week later, the first four votes only lean
  on the model, outlets show as articles on the review card.
- The hub counts a signed read as a visit (retention), caches identical article-source searches for ten
  minutes (shared-address rate limits), and deploys from GitHub instead of a paste.

## Update: writers

A byline is now an account on the `press` platform. It is read from the full article after a run (JSON-LD author, meta author, the page's byline, a rel=author link). Desks, wires and outlet names are not writers.

What the web draws for a writer:

- a tier-1 "writes for" link to the outlet that printed the piece, with the articles behind it
- a tier-1 link to each co-author on a shared byline
- a tier-1 mention whenever a post or another outlet names the writer (the name is never a separate diamond)
- tier-2 links to the names in their own articles

WRITERS ONLY in the web keeps the writers and the outlets they write for. Tap a writer node twice (or WRITER in the focus bar) for the dossier. The topic dossier has a "Who writes about it" card.

The writer dossier is built from the collected articles and the outlet's own author page, nothing else: outlets over time, co-authors, who names them, what they name, the datelines their stories carry (where they report from, never where they live), the handles the outlet lists for them, and the articles. A listed handle is offered as a tap-to-link. It becomes a link only when you tap it. The app never ties a byline to an account by itself.

Known gaps: outlets that print no byline in the HTML, bylines with titles ("Staff Writer Jane Doe"), and the same writer spelled two ways (J. Doe / Jane Doe) are two nodes. Link them under one person if they are.

## Update: signals

A topic is now read as a whole, not only post by post. Dossier → SIGNALS, and a badge on the topic card after each run. Counting, time and words only; every figure links to the posts behind it.

- **Trend**: posts per day, a burst when a day runs more than two standard deviations above the week before it, and a state: surging, rising, steady, fading, quiet, new. "Just before the burst" lists what first appeared in the two days before take-off (an outlet, an account, a name).
- **Spread**: networks in the order the topic reached them, how many voices, how many joined this week, whether news led or followed the posts.
- **Who moved it**: reach (likes, reposts, replies, views), being named by others, posting before the burst, volume. Each with the reasons.
- **Heat**: anger words, shouting, replies swamping likes, 0..100 with the parts shown. Tone, not who is right.
- **What kind of problem**: safety, health, housing, weather, labor, discrimination, corruption, outages, education, cost of living, immigration, by the words used. Shares, not verdicts.
- **Storylines**: posts grouped by their most telling shared word, named by the words that belong to that group.
- **Same words, same links**: three or more accounts with the same text or the same link. A sign, not proof. The note says so.

Known gaps: sarcasm reads as heat; a share button that copies text reads as a copy; a topic with no dates has no trend; the lexicons are English.

## Update: in short

The dossier opens with eight lines, each backed by a card below: what it is, since when (born, peak, silence), what started it (the post or article the burst followed, whether news or posts came first), why it moves (who carried it, the biggest post, the tone, same-words posting), who cares (the circles and the networks), where (datelines and places named after in / at / near), momentum (this week against last, voices joining, storylines appearing or dying, outlets on it or not; a slope, not a forecast), overlaps with other topics in the library, and next (sources to add, accounts to pull, a name worth its own dossier).

## Update: claims, numbers, dates, trust

- **Claims**: sentences that assert something, grouped when they share most of their words. Each carries who said it first, how many voices repeat it, which outlets printed it, and whether a later post disputes it. Status is "posts only", "an outlet confirms" or "disputed". The first confirmed claim becomes the What line of IN SHORT.
- **Numbers that move**: the same figure (customers, deaths, $ per gallon, mph) mentioned over time, with each mention linked. A figure mentioned once is not a series.
- **Dates in the posts**: dates written in the text, resolved against the post's own date. Month-day, weekdays (next / last / bare, past tense means the one just gone), tonight, tomorrow, yesterday. Split into coming up and happened. Coming up feeds the Next line.
- **Trust**: solid, fair or thin, from posts, networks, sources that switched themselves off, days with nothing, and what the time window cut. Shown on IN SHORT with the reasons. A quiet signal on a thin read is not a quiet topic.

Known gaps: a claim and its paraphrase in different words are two claims; a number with no noun after it is skipped; dates without a month ("the 14th") are skipped; sarcastic disputes read as disputes.
