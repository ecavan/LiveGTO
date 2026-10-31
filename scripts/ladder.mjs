// Elo ladder from a round robin between the bots (duplicate matches, every pair):
//   avg(X)  = X's mean win rate against the other bots, bb/100 ("how much does X make at this table")
//   W       = avg(Pro) − avg(X)                         (the Pro is the strongest bot; ≥ 0)
//   Elo(X)  = 2000 − 900·log10(1 + W/25)
// A player who makes 25bb/100 less than the Pro against the same field is ~1730, 100bb/100 less
// ~1370, 400bb/100 less ~890. Your own Play rating uses the same curve from your duplicate edge
// over the bot you play. Rating by winnings against the field, not by how badly the Pro beats
// you: the Pro is a best-responder, and "hard for the Pro to exploit" (a Nit) is not "wins money".
//
//   npx vite-node scripts/ladder.mjs [hands]                 run the whole round robin (hours)
//   npx vite-node scripts/ladder.mjs --from results.json     { a: { b: a's edge over b, … }, … }
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
  results = {};
  for (let i = 0; i < AGENT_IDS.length; i++) {
    for (let j = i + 1; j < AGENT_IDS.length; j++) {
      const [a, b] = [AGENT_IDS[i], AGENT_IDS[j]];
      (results[a] ||= {})[b] = +(-match(b, a, N, 17).mean).toFixed(1);
      console.log(a, 'vs', b, results[a][b]);
    }
  }
}
const ids = AGENT_IDS.filter(id => results[id] || Object.values(results).some(r => r && r[id] != null));
const edge = (a, b) => (results[a]?.[b] != null ? results[a][b] : results[b]?.[a] != null ? -results[b][a] : null);
const avg = {};
for (const a of ids) {
  const es = ids.filter(b => b !== a).map(b => edge(a, b)).filter(x => x != null);
  avg[a] = es.length ? es.reduce((x, y) => x + y, 0) / es.length : null;
}
const elo = {};
for (const a of ids) if (avg[a] != null) elo[a] = round10(Math.min(ANCHOR, ANCHOR - gap(avg.pro - avg[a])));
const ci = results.ci || {};
writeFileSync('src/engine/hu/ladder.json', JSON.stringify({ anchor: ANCHOR, slope: SLOPE, w0: W0, elo, avg: Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, v == null ? null : +v.toFixed(1)])), results: Object.fromEntries(Object.entries(results).filter(([k]) => k !== 'ci')), ci }, null, 1));
console.log(elo);
console.log('avg vs field', Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, v?.toFixed(1)])));
