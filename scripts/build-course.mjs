// Import the Boot Camp course into public/course.json, with the corrections in
// src/content/errata.js. Run: node scripts/build-course.mjs /path/to/Poker_Boot_Camp.html
import { readFileSync, writeFileSync } from 'node:fs';
import { ERRATA } from '../src/content/errata.js';

const html = readFileSync(process.argv[2], 'utf8');
const i = html.indexOf('const COURSE=');
let j = i + 13, depth = 0, inS = false, esc = false, q = '';
for (; j < html.length; j++) {
  const c = html[j];
  if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) inS = false; continue; }
  if (c === '"' || c === "'") { inS = true; q = c; continue; }
  if (c === '[' || c === '{') depth++;
  if (c === ']' || c === '}') { depth--; if (depth === 0) { j++; break; } }
}
const course = JSON.parse(html.slice(i + 13, j));
let applied = 0;
for (const e of ERRATA) {
  const step = course[e.module].steps.find(s => (s.title || s.prompt || '').startsWith(e.match));
  if (!step) { console.warn('errata: no step', e.module, e.match); continue; }
  step[e.field] = (step[e.field] || '') + `<div class="erratum"><b>Correction.</b> ${e.note}</div>`;
  applied++;
}
writeFileSync('public/course.json', JSON.stringify({ version: 1, source: 'Poker Boot Camp v2', modules: course }));
console.log(`course: ${course.length} modules, ${course.reduce((a, m) => a + m.steps.length, 0)} steps, ${applied}/${ERRATA.length} corrections`);
