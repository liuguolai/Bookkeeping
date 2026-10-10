import type { State } from './model';

// One pass over records, shared by the picker and sync summary (including archived books).
export function bookOverview(state: State) {
  const rows = state.books
    .filter((book) => !book.deletedAt)
    .map((book) => ({
      book,
      count: 0,
      latest: '',
    }));
  const byId = new Map(rows.map((row) => [row.book.id, row]));
  for (const entry of state.entries) {
    const row = byId.get(entry.bookId);
    if (!row || entry.deletedAt) continue;
    row.count++;
    if (entry.occurredAt > row.latest) row.latest = entry.occurredAt;
  }
  return rows;
}

export function syncSummary(state: State) {
  const rows = bookOverview(state);
  return { books: rows.length, entries: rows.reduce((sum, row) => sum + row.count, 0) };
}
