// Head-to-head match between two agents (or a crude strategy: shover, calldown, flopshover).
// Run: npx vite-node scripts/match.mjs <a> <b> [hands] [seed]
import { match } from './lib/match.mjs';
import { AGENTS } from '../src/engine/hu/agents.js';

if (process.argv[2]) {
  const [a, b, n = 400, seed = 1] = process.argv.slice(2);
  const t = performance.now();
  const r = match(a, b, Number(n), Number(seed));
  console.log(`${a} vs ${b}: ${r.mean.toFixed(1)} ± ${r.ci.toFixed(1)} bb/100 (${n} hands, ${((performance.now() - t) / n).toFixed(0)} ms/hand)`);
  if (AGENTS[b]?.kind === 'thinker') console.log('read:', JSON.stringify(Object.fromEntries(Object.entries(r.model.pi).map(([k, v]) => [k, +v.toFixed(3)]))));
}
