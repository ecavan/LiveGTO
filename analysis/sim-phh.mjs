// Bot tables written as PHH hand histories, so the bots go through exactly the same stats code
// (solver/crates/ps-phh) as the real hands.
//
// Six pure archetypes per table, drawn from a live-like pool, 100bb, blinds 0.5/1, no hero and
// no adjusting (nobody to adjust to). Every player is named after his archetype, so the stats
// come out per archetype. Hole cards are dealt face up, like the Pluribus logs.
//
// Run: npx vite-node analysis/sim-phh.mjs <hands> <out.phhs> [seed] [pool-json] [--preflop] [--pre file.json]
//   --preflop       stop each hand at the flop (fast; for fitting the preflop numbers)
//   --pre file      use these preflop numbers instead of src/engine/ring/preflop.json
//   --profiles file use these villain profiles (profiles.json format) instead of the exported ones
import { writeFileSync, readFileSync } from 'node:fs';
import { newHand, act, rng, board } from '../src/engine/ring/game.js';
import { playerPolicyAll, ARCHETYPES } from '../src/engine/ring/players.js';
import { comboIndex } from '../src/engine/hu/equity.js';
import { cardStr } from '../src/engine/hu/hand.js';
import PROFILES from '../src/engine/hu/profiles.json';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const PREFLOP_ONLY = flag('--preflop');
if (opt('--pre')) {
  const pre = JSON.parse(readFileSync(opt('--pre'), 'utf8'));
  for (const [k, v] of Object.entries(pre)) if (ARCHETYPES[k]) ARCHETYPES[k].pre = v;
}
if (opt('--profiles')) Object.assign(PROFILES, JSON.parse(readFileSync(opt('--profiles'), 'utf8')));
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--pre', '--profiles'].includes(argv[i - 1])));
const [H = 2000, out = 'bots.phhs', seed = 1, poolArg] = pos;
const POOL = poolArg ? JSON.parse(poolArg) : { station: 0.16, passive: 0.12, whale: 0.12, nit: 0.14, reg: 0.16, maniac: 0.08, shark: 0.11, pro: 0.11 };
const rand = rng(Number(seed));
const NONE = { adj: 0, vsHero: false, heroInBlinds: false, heroTight: false, heroAggro: false, heroBluffy: false, heroHonest: false };

function pick(w) {
  let x = rand() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) { x -= v; if (x <= 0) return k; }
  return Object.keys(w)[0];
}
const player = (arch) => ({ name: arch, mix: { [arch]: 1 }, learn: 0, ramp: 1 });
const fmt = (x) => (Math.round(x * 100) / 100).toString();

const n = 6;
let seats = Array.from({ length: n }, () => player(pick(POOL)));
let btn = 0;
const chunks = [];
for (let h = 0; h < Number(H); h++) {
  // now and then a seat changes (keeps the mix of opponents varied)
  if (rand() < 0.1) seats[Math.floor(rand() * n)] = player(pick(POOL));
  btn = (btn + 1) % n;
  let s = newHand({ n, btn, rand });
  while (!s.done && !(PREFLOP_ONLY && s.street > 0)) {
    const seat = s.toAct;
    const pol = playerPolicyAll(seats[seat], s, seat, NONE);
    const i = comboIndex(s.holes[seat][0], s.holes[seat][1]);
    let x = rand();
    let k = pol.opts.length - 1;
    for (let j = 0; j < pol.opts.length; j++) { x -= pol.P[j][i]; if (x <= 0) { k = j; break; } }
    const o = pol.opts[k];
    s = act(s, o.type === 'fold' || o.type === 'check' || o.type === 'call' ? { type: o.type } : { type: o.type, to: o.to });
  }
  // PHH order: small blind first, button last
  const order = Array.from({ length: n }, (_, j) => (s.sb + j) % n);
  const pIdx = Object.fromEntries(order.map((seat, j) => [seat, j + 1]));
  const actions = order.map((seat, j) => `d dh p${j + 1} ${s.holes[seat].map(cardStr).join('')}`);
  let street = 0;
  const deal = (to) => {
    while (street < to) {
      street++;
      const cards = street === 1 ? s.runout.slice(0, 3) : [s.runout[street + 1]];
      actions.push(`d db ${cards.map(cardStr).join('')}`);
    }
  };
  for (const e of s.log) {
    deal(e.street);
    const p = `p${pIdx[e.seat]}`;
    if (e.type === 'fold') actions.push(`${p} f`);
    else if (e.type === 'check' || e.type === 'call' || (e.type === 'allin' && e.callAllIn)) actions.push(`${p} cc`);
    else actions.push(`${p} cbr ${fmt(e.to)}`);
  }
  if (s.done && s.result.showdown) {
    deal(3);
    for (const seat of order) if (!s.folded[seat]) actions.push(`p${pIdx[seat]} sm ${s.holes[seat].map(cardStr).join('')}`);
  }
  void board;
  chunks.push(
    `[${h + 1}]\nvariant = 'NT'\nantes = [${order.map(() => 0).join(', ')}]\n` +
    `blinds_or_straddles = [${order.map((_, j) => (j === 0 ? 0.5 : j === 1 ? 1 : 0)).join(', ')}]\nmin_bet = 1\n` +
    `starting_stacks = [${order.map(seat => fmt(s.start[seat])).join(', ')}]\n` +
    `actions = [${actions.map(a => `'${a}'`).join(', ')}]\n` +
    `venue = 'LiveGTO'\nhand = ${h + 1}\n` +
    `players = [${order.map(seat => `'${seats[seat].name}'`).join(', ')}]\n` +
    (s.done ? `winnings = [${order.map(seat => fmt(s.result.won[seat])).join(', ')}]\n` : ''),
  );
}
writeFileSync(out, chunks.join('\n'));
console.error(`${H} hands → ${out} (archetypes: ${Object.keys(POOL).filter(k => ARCHETYPES[k]).join(', ')})`);
