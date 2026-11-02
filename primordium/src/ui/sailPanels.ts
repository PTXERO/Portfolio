// The Age of Sail's panels: the world, your islands on it.

import type { GameState } from '../economy/types';

export function worldLayout(state: GameState): string {
  const world = state.stages.sail.world;
  if (!world) return '';
  const mine = world.isles.filter((i) => i.mine !== undefined).sort((a, b) => (a.mine === -1 ? 1 : b.mine === -1 ? -1 : a.mine! - b.mine!));
  const found = world.isles.filter((i) => i.found && i.mine === undefined).length;
  const rows = mine
    .map((i) => `<div class="card px-box build"><div class="info"><div class="name">${i.mine === -1 ? 'Home: the Republic' : `Island ${i.mine! + 1}`}</div><div class="sub">${i.mine === -1 ? 'Where they set sail from.' : 'As it was left.'}</div></div><button class="px-btn buy" data-worldisle="${i.id}">Go and see</button></div>`)
    .join('');
  return `<div class="panel-head"><h2>The world</h2><span class="dim">${mine.length} yours · ${found} seen</span></div>
    <p class="tiny dim">The rest is fog. Ships, routes and the islands beyond come next.</p>
    ${rows}`;
}
