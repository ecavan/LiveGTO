// Elo ladder, referenced to the strongest bot (Pro):
//   Elo(X) = 2000 − 900·log10(1 + W/25)       W = the Pro's win rate against X, bb/100 (≥ 0)
// "How badly does the best bot beat you?" A player the Pro beats by 25bb/100 is ~1730, by
// 100bb/100 ~1370, by 400bb/100 ~890. Matches are duplicate (each deal played from both seats).
//
// The Shark is rated through the profile bots (thinking bot vs thinking bot is too noisy):
//   Elo(Shark) = mean over X of  Elo(X) + 900·log10(1 + W_Shark,X / 25)
//
//   npx vite-node scripts/ladder.mjs [hands]                 run everything
//   npx vite-node scripts/ladder.mjs --from results.json     { pro: {id: W}, shark: {id: W} }
import { writeFileSync, readFileSync } from 'node:fs';
import { match } from './lib/match.mjs';
import { AGENTS, AGENT_IDS } from '../src/engine/hu/agents.js';

export const ANCHOR = 2000, SLOPE = 900, W0 = 25;
const gap = (w) => SLOPE * Math.log10(1 + Math.max(0, w) / W0);
const round10 = (x) => Math.round(x / 10) * 10;

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
let results;
if (fromIdx >= 0) results = JSON.parse(readFileSync(args[fromIdx + 1], 'utf8'));
else {
  const N = Number(args.find(a => /^\d+$/.test(a)) || 6000);
  results = { pro: {}, shark: {} };
  const profiles = AGENT_IDS.filter(id => AGENTS[id].kind === 'profile');
  for (const id of profiles) { results.pro[id] = +(-match(id, 'pro', N, 17).mean).toFixed(1); console.log('pro vs', id, results.pro[id]); }
  for (const id of ['reg', 'nit', 'station']) { results.shark[id] = +(-match(id, 'shark', N, 17).mean).toFixed(1); console.log('shark vs', id, results.shark[id]); }
}
const elo = { pro: ANCHOR };
for (const [id, w] of Object.entries(results.pro)) elo[id] = round10(ANCHOR - gap(w));
const est = Object.entries(results.shark || {}).map(([id, w]) => elo[id] + gap(w));
if (est.length) elo.shark = round10(Math.min(ANCHOR, est.reduce((a, b) => a + b, 0) / est.length));
writeFileSync('src/engine/hu/ladder.json', JSON.stringify({ anchor: ANCHOR, slope: SLOPE, w0: W0, elo, results }, null, 1));
console.log(elo);
