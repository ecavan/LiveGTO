// Exports solver/profiles/*.toml to src/engine/hu/profiles.json so the bots in Play/Simulate
// use exactly the same villain definitions as the solver's puzzles.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parse } from 'smol-toml';

const dir = 'solver/profiles';
const out = {};
for (const f of readdirSync(dir).filter(f => f.endsWith('.toml')).sort()) {
  out[f.replace('.toml', '')] = parse(readFileSync(`${dir}/${f}`, 'utf8'));
}
writeFileSync('src/engine/hu/profiles.json', JSON.stringify(out, null, 1) + '\n');
console.log('profiles:', Object.keys(out).join(', '));
