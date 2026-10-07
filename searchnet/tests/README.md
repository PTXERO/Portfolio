# Tests

- `python -m unittest discover -s server -p 'test_*.py'` from `searchnet/`: the PC server (sources, learning, planner, web, signals, writers).
- `node hub/build/test_hub.mjs` from the repo root: the generated hub Worker against a fake Supabase (ids, quota, pool, store, cache, replay, cron).
- `node searchnet/tests/worker.cjs`: the SearchNet Worker's parsers in a sandbox.
- `node searchnet/tests/browser/<name>.mjs`: browser mode end to end with Playwright and a mocked hub. Set `PW_MODULE` to a Playwright install if it is not on the path. `hubphone` and `where` are the hub page on a phone; `keepsafe` is the weekly backup and the restore offer; `signals`, `writers`, `topicflow` are the dossier, the writer layer and the topic flow.

`.github/workflows/tests.yml` runs all of it on every push.
