// The preflop charts the coach uses (src/engine/ranges.js), as JSON, for the Python analysis.
// Run: npx vite-node analysis/dump-charts.mjs > charts.json
import { RFI_RANGES, FACING_OPEN } from '../src/engine/ranges.js';

const out = { rfi: {}, facing: {} };
for (const [k, v] of Object.entries(RFI_RANGES)) out.rfi[k] = [...v];
for (const [k, v] of Object.entries(FACING_OPEN)) out.facing[k] = { raise: [...v.raise], call: [...v.call] };
console.log(JSON.stringify(out));
