// Makes New Shore's island away from the game (a few seconds' work), so nothing stutters.
import { generateTerrain } from './terrain';

self.onmessage = (e: MessageEvent<{ seed: number; n: number }>) => {
  const { seed, n } = e.data;
  const t = generateTerrain(seed, n);
  (self as unknown as Worker).postMessage({ seed, height: t.height, biome: t.biome, home: t.home }, [t.height.buffer, t.biome.buffer]);
};
