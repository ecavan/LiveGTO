// Bot league: Reg vs each villain type, alternating seats. Prints bb/100 ± 95% CI.
// Run: npx vite-node scripts/bot-league.mjs [hands]
import { newHand, act, rng } from '../src/engine/hu/game.js';
import { chooseAction, BOT_TYPES } from '../src/engine/hu/bots.js';

const N = Number(process.argv[2] || 20000);
const rand = rng(424242);
for (const opp of Object.keys(BOT_TYPES).filter(k => k !== 'reg')) {
  const res = [];
  for (let i = 0; i < N; i++) {
    const regSeat = i % 2;
    const bots = regSeat === 0 ? ['reg', opp] : [opp, 'reg'];
    let s = newHand({ rand });
    while (!s.done) s = act(s, chooseAction(bots[s.toAct], s, rand));
    res.push(s.result.net[regSeat] - 0.25); // remove the dead-money bias (0.5 split evenly on average)
  }
  const m = res.reduce((a, b) => a + b, 0) / N;
  const sd = Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1));
  console.log(`Reg vs ${opp.padEnd(8)} ${(100 * m).toFixed(1).padStart(7)} bb/100  ± ${(196 * sd / Math.sqrt(N)).toFixed(1)}`);
}
