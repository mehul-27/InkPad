// Phase 5: tiny subsequence matcher shared by the command palette and the
// quick file switcher. Scores contiguous and word-initial matches higher;
// -1 means no match. Good enough for a handful of commands and recent files.

export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    qi++;
    score += ti === prev + 1 ? 3 : 1;
    if (ti === 0) score += 2;
    prev = ti;
  }
  return qi === q.length ? score : -1;
}

export function fuzzySort<T>(query: string, items: T[], text: (item: T) => string): T[] {
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = fuzzyScore(query, text(item));
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || text(a.item).localeCompare(text(b.item)));
  return scored.map((s) => s.item);
}
