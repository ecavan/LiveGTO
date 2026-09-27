// How hard is each live-table level? A solid reg (the table's own Reg style) sits in seat 0 and
// plays N hands at each level; prints his win rate. Run: npx vite-node scripts/table-levels.mjs [hands]
import { rng } from '../src/engine/ring/game.js';
import { createTable, startHand, botAct, endHand, summary, HERO } from '../src/engine/ring/session.js';
import { randomPlayer } from '../src/engine/ring/players.js';

const H = Number(process.argv[2] || 2000);
for (const level of ['easy', 'medium', 'hard']) {
  const res = [];
  for (let rep = 0; rep < 4; rep++) {
    const rand = rng(100 + rep);
    const t = createTable({ n: 6, level, rand });
    t.players[HERO] = { ...randomPlayer(rand, new Set(), 'reg'), mix: { reg: 1 }, hud: { hands: 0, vpip: 0, pfr: 0 } };
    for (let h = 0; h < H / 4; h++) {
      startHand(t, rand);
      while (!t.s.done) botAct(t, rand);
      const hh = endHand(t);
      res.push(hh.net);
    }
  }
  const m = res.reduce((a, b) => a + b, 0) / res.length;
  const sd = Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / (res.length - 1));
  console.log(level.padEnd(7), `reg wins ${(100 * m).toFixed(1)} ± ${(196 * sd / Math.sqrt(res.length)).toFixed(1)} bb/100`);
}
