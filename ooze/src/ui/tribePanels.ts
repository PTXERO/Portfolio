// The Tribal era's panel. For now: who lived, the spear, and what's to come.

import { STORY } from '../content/tribal';
import { tribeOf } from '../economy/tribal';
import type { GameState } from '../economy/types';

export function tribeLayout(state: GameState): string {
  const t = tribeOf(state);
  if (!t) return '';
  if (!t.awake) {
    return `<div class="panel-head"><h2>Survivors</h2></div>
      <div class="card px-box"><div class="info"><div class="name">${t.survivors} of the herd lived</div>
      <div class="sub">${STORY.approach}</div></div></div>
      <p class="note">Tap the spear in the crater.</p>`;
  }
  return `<div class="panel-head"><h2>The tribe</h2></div>
    <div class="card px-box"><div class="info"><div class="name">${t.survivors} lived through the strike</div>
    <div class="sub">They're awake now. What they carry from before (their heritage): everything they do ×${t.heritage.toFixed(2)}.</div></div></div>
    <p class="note lock">Jobs, building and ideas are next.</p>`;
}
