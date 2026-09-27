// Calibrate the Play rating: each bot plays the Pro with the coach grading its decisions exactly
// as it grades yours (L = EV lost per 100 hands). Then fit  R(L) = a − b·log2(1 + L/L0)  so each
// profile bot's L maps to its ladder Elo.
//   npx vite-node scripts/calibrate.mjs measure <hands> <ids> <out.json>
//   npx vite-node scripts/calibrate.mjs fit [--top 2100] <in1.json> [in2.json …]
// --top fixes R(0), the rating of play the coach can't fault (above the Pro, who is exploitable).
import { writeFileSync, readFileSync } from 'node:fs';
import { rng } from '../src/engine/hu/game.js';
import { createAgent, choose } from '../src/engine/hu/agents.js';
import { createSession, startHand, heroToAct, coachNow, heroAct, botAct, endHand, summary } from '../src/engine/hu/session.js';
import { matchOption } from '../src/engine/hu/policy.js';

const [mode, ...rest] = process.argv.slice(2);

if (mode === 'measure') {
  const [H, ids, out] = [Number(rest[0]), rest[1].split(','), rest[2]];
  const points = {};
  for (const id of ids) {
    const rand = rng(99);
    const me = createAgent(id);
    const sess = createSession({ botId: 'pro' });
    for (let h = 0; h < H; h++) {
      startHand(sess, rand);
      while (!sess.s.done) {
        if (heroToAct(sess)) {
          const k = coachNow(sess);
          const idx = matchOption(k.options, choose(me, sess.s, rand));
          heroAct(sess, idx >= 0 ? idx : 0);
        } else botAct(sess, rand);
      }
      endHand(sess);
    }
    const sum = summary(sess);
    points[id] = { L: sum.lossPer100, acc: +sum.accuracy.toFixed(3), hands: H };
    console.log(id, points[id]);
    writeFileSync(out, JSON.stringify(points, null, 1));
  }
} else if (mode === 'fit') {
  const LADDER = JSON.parse(readFileSync('src/engine/hu/ladder.json', 'utf8'));
  const ti = rest.indexOf('--top');
  const top = ti >= 0 ? Number(rest[ti + 1]) : null;
  const files = rest.filter((x, i) => x !== '--top' && i !== ti + 1);
  const points = Object.assign({}, ...files.map(f => JSON.parse(readFileSync(f, 'utf8'))));
  for (const [id, p] of Object.entries(points)) p.elo = LADDER.elo[id] ?? null;
  // thinking bots misread each other (they model opponents as player *types*), which inflates
  // their measured loss against the Pro: fit on the profile bots only.
  const anchored = Object.entries(points).filter(([id, p]) => p.elo != null && !['pro', 'shark'].includes(id)).map(([, p]) => p);
  let best = null;
  for (let L0 = 5; L0 <= 1500; L0 += 5) for (let b = 50; b <= 3000; b += 10) {
    const g = (L) => Math.log2(1 + L / L0);
    const a = top ?? anchored.reduce((s, p) => s + p.elo + b * g(p.L), 0) / anchored.length;
    const err = anchored.reduce((s, p) => s + (a - b * g(p.L) - p.elo) ** 2, 0);
    if (!best || err < best.err) best = { a: Math.round(a), b, L0, err };
  }
  const R = (L) => Math.round((best.a - best.b * Math.log2(1 + L / best.L0)) / 10) * 10;
  for (const p of Object.values(points)) p.fitted = R(p.L);
  const rmse = Math.round(Math.sqrt(best.err / anchored.length));
  writeFileSync('src/engine/hu/calibration.json', JSON.stringify({ fit: { a: best.a, b: best.b, L0: best.L0 }, rmse, points }, null, 1));
  console.log('fit', best, 'rmse', rmse, points);
}
