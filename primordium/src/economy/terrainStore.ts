// New Shore's island, made once and kept: the first time it's needed (or better, while the
// crossing plays) a worker makes it in the background; after that it's loaded from the device
// (IndexedDB), never made again. Browser only.

import { provideTerrain, SHORE_N, terrainReady } from './shore';
import { TERRAIN_V, type Terrain } from './terrain';

const DB = 'ooze-to-orbit';
const STORE = 'islands';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function load(key: string): Promise<Terrain | undefined> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => res(q.result as Terrain | undefined);
      q.onerror = () => res(undefined);
    });
  } catch {
    return undefined;
  }
}

async function keep(key: string, t: Terrain): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(t, key);
  } catch {
    /* no storage (private browsing): it's made again next time */
  }
}

function make(seed: number): Promise<Terrain> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Terrain & { seed: number }>) => {
      w.terminate();
      res({ height: e.data.height, biome: e.data.biome, home: e.data.home });
    };
    w.onerror = (e) => {
      w.terminate();
      rej(e);
    };
    w.postMessage({ seed, n: SHORE_N });
  });
}

const pending = new Map<number, Promise<void>>();

/** Gets New Shore's island ready for a seed: loaded if it's been made before, else made now
 * in the background (and kept). Resolves once the game can use it. */
export function prepareShoreIsland(seed: number): Promise<void> {
  if (terrainReady(seed)) return Promise.resolve();
  let p = pending.get(seed);
  if (!p) {
    const key = `shore-v${TERRAIN_V}-${seed}`;
    p = (async () => {
      let t = await load(key);
      if (!t) {
        t = await make(seed);
        void keep(key, t);
      }
      if (!terrainReady(seed)) provideTerrain(seed, t);
    })();
    pending.set(seed, p);
  }
  return p;
}
