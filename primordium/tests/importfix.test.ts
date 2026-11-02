import { expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { exportSave, importSave } from '../src/economy/save';

it('reads a save code with stray characters from copying', () => {
  const s = createState(0);
  s.taps = 449;
  const code = exportSave(s);
  for (const bad of [code, ` ${code}\n`, code.replace(/=+$/, '') + 'i==', code.slice(0, 40) + '\n' + code.slice(40)]) {
    expect(importSave(bad).taps).toBe(449);
  }
});
