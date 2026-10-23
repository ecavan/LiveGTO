// Leak drills: every postflop leak in the report has a drill, and the drill serves spots of the
// right kind from the real puzzle library, about two thirds of them "target" spots.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { LEAK_DRILLS, TARGET_SHARE, pickDrill, candidates } from '../src/engine/puzzles.js';
import { LEAKS } from '../src/engine/history.js';

const DIR = new URL('../public/library/', import.meta.url);
const haveLib = existsSync(new URL('index.json', DIR));
const files = {};
const loadRecord = async (c) => {
  files[c.file] ||= JSON.parse(readFileSync(new URL(c.file, DIR)));
  return files[c.file].records.find(r => r.id === c.id);
};
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

describe('leak drills', () => {
  it('covers every postflop leak', () => {
    for (const k of Object.keys(LEAKS)) if (!k.startsWith('pre-')) expect(LEAK_DRILLS[k], k).toBeTruthy();
  });
  it.runIf(haveLib)('serves the right spots, mostly targets', async () => {
    const index = JSON.parse(readFileSync(new URL('index.json', DIR)));
    for (const [leak, d] of Object.entries(LEAK_DRILLS)) {
      for (const level of [1, 2]) {
        const rand = rng(7);
        let n = 0, hits = 0;
        for (let t = 0; t < 30; t++) {
          const c = await pickDrill(index, leak, { level, rating: 1200, loadRecord, rand });
          expect(c, `${leak} L${level}`).toBeTruthy();
          const r = await loadRecord(c);
          if (d.decision === 'facing') expect(r.to_call).toBeGreaterThan(0);
          if (d.decision === 'betting') expect(r.to_call).toBe(0);
          expect(level === 1 ? r.villain.profile === 'gto' : r.villain.profile !== 'gto').toBe(true);
          n++; if (d.target(r.puzzles[c.i], r)) hits++;
        }
        expect(hits / n, `${leak} L${level} target share`).toBeGreaterThan(TARGET_SHARE - 0.25);
        expect(hits / n, `${leak} L${level} target share`).toBeLessThan(0.95);
      }
    }
  }, 120000);
  it.runIf(haveLib)('candidates exist for both decisions at both levels', () => {
    const index = JSON.parse(readFileSync(new URL('index.json', DIR)));
    for (const level of [1, 2]) for (const decision of ['facing', 'betting']) expect(candidates(index, { level, decision }).length).toBeGreaterThan(100);
  });
});
