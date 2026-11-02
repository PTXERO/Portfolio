// Renders New Shore's island for a few seeds to PNG-ready raw files (for checking the generator).
import { writeFileSync } from 'fs';
import { generateTerrain } from '../src/economy/terrain';
const out = process.argv[2] ?? '.';
for (const seed of (process.argv[3] ?? '11,222,3333').split(',').map(Number)) {
  const t0 = Date.now();
  const t = generateTerrain(seed, 1020);
  console.log(seed, Date.now() - t0, 'ms', t.home);
  writeFileSync(`${out}/t${seed}.b`, t.biome);
  writeFileSync(`${out}/t${seed}.h`, Buffer.from(t.height.buffer));
}
