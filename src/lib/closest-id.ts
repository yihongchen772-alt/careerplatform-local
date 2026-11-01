/**
 * The ID a model meant: itself, or the one candidate it differs from by a
 * couple of characters (long IDs get miscopied now and then).
 */
export function closestId(given: string, candidates: Iterable<string>): string | null {
  const list = [...candidates];
  if (list.includes(given)) return given;
  const near = list.filter((id) => Math.abs(id.length - given.length) <= 2 && editDistance(id, given) <= 3);
  return near.length === 1 ? near[0] : null;
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
