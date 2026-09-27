/**
 * The solved puzzle library (public/library): index and per-flop files, fetched once and kept.
 */
let index = null;
const files = new Map();

export async function getIndex() {
  if (!index) {
    const res = await fetch('/library/index.json');
    if (!res.ok) throw new Error('Puzzle library not found');
    index = await res.json();
  }
  return index;
}

export async function getFile(file) {
  if (!files.has(file)) {
    const res = await fetch(`/library/${file}`);
    if (!res.ok) throw new Error(`Missing ${file}`);
    files.set(file, await res.json());
  }
  return files.get(file);
}

export async function getRecord(cand) {
  const f = await getFile(cand.file);
  return f.records.find(r => r.id === cand.id);
}
