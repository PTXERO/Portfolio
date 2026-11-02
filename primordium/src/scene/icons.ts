// Icons for the Cell's living things, drawn with the same code as the scene so
// the Grow tab always shows what you'll see swimming: the lineage's own colours
// in the Shallows, the glowing ambushers of the Depths, the red rods of the Vents.

import { PAL } from '../art/sprites';
import type { GameState } from '../economy/types';
import { drawBlob, type BlobStyle } from './blob';
import { DIET_COLORS, drawCellLook, lookOf, type Look } from './cellLook';

const W = 12;
const H = 12;
const SCALE = 3;
const urls = new Map<string, string>();

type Kind = { cell: Look['species'] } | { blob: 'shallows' | 'depths' };
const KINDS: Record<string, Kind> = {
  fission: { cell: 'shallows' },
  ambusher: { cell: 'depths' },
  thermophile: { cell: 'vents' },
  colony: { blob: 'shallows' },
  pack: { blob: 'depths' },
};

/** An <img> of a generator as the scene draws it, or null to use its sprite. */
export function lifeIcon(state: GameState, gen: string): string | null {
  const kind = KINDS[gen];
  if (!kind) return null;
  const look: Look = { ...lookOf(state, 'cell'), flagella: 0, cilia: false, thick: false, eyespot: false, spikes: false, toxin: false, organelles: [], settled: undefined };
  const key = `${gen}|${look.diet}`;
  let url = urls.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const b = c.getContext('2d')!;
    if ('cell' in kind) {
      // Two of them, like the swarm: one a little behind the other.
      drawCellLook(b, { ...look, species: kind.cell }, 4, 4, { rx: 3 });
      drawCellLook(b, { ...look, species: kind.cell }, 8, 8, { rx: 3, left: true, frame: 1 });
    } else {
      const [fill, edge] = DIET_COLORS[look.diet ?? 'none'];
      const style: BlobStyle = kind.blob === 'depths' ? { edge: '#7fd3f0', body: '#1c3550', nucleus: '#b8f0ff' } : { edge, body: fill, nucleus: PAL.n };
      const cores = [
        { x: 4, y: 5, r: 2.6, nucleus: true },
        { x: 8, y: 5.5, r: 2.4, nucleus: true },
        { x: 6, y: 8.5, r: 2.3, nucleus: true },
      ];
      drawBlob(b, cores, style);
    }
    url = c.toDataURL();
    urls.set(key, url);
  }
  return `<img class="px-icon" src="${url}" width="${W * SCALE}" height="${H * SCALE}" alt="" draggable="false">`;
}
