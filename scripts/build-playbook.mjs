/**
 * Builds public/library/playbook.json from the puzzle library: for every solved spot, what each
 * hand class does (one action per combo, as shares), vs the villain type and vs GTO, tagged with
 * the flop texture. The Playbook screen aggregates these into rules you can remember.
 *
 *   node scripts/build-playbook.mjs [libraryDir]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { flopTexture } from '../src/engine/texture.js';
import { actionCategory } from '../src/engine/playbook.js';

const dir = process.argv[2] || 'public/library';
const FACING = new Set(['oop_vs_bet', 'ip_vs_bet']);
const r3 = (x) => Math.round(x * 1000) / 1000;

function cats(pure, labels) {
  const out = {};
  pure.forEach((w, i) => {
    if (w > 0) {
      const c = actionCategory(labels[i]);
      out[c] = r3((out[c] || 0) + w);
    }
  });
  return out;
}

const entries = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json' && f !== 'playbook.json').sort()) {
  const { records } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const r of records) {
    const t = flopTexture(r.board);
    const c = {};
    for (const row of r.classes) {
      c[row.class] = [r3(row.exploit.weight), cats(row.exploit.pure, r.actions_short), r3(row.gto.weight), cats(row.gto.pure, r.actions_short)];
    }
    entries.push({
      f: r.family, s: r.street, d: FACING.has(r.decision) ? 'facing' : 'betting', v: r.villain.profile,
      t: [t.suits, t.connect, t.paired, t.height], c,
    });
  }
}
writeFileSync(join(dir, 'playbook.json'), JSON.stringify({ version: 1, entries }));
console.log(`playbook: ${entries.length} spots`);
