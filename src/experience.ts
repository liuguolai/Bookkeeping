import { localTime, type Category, type State, type Entry } from './model';
import { touch, writableBook } from './domain';

export function orderedCategories(categories: Category[]) {
  return [...categories].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
}

export function frequentNotes(
  entries: Entry[],
  bookId: string,
  categoryId: string,
  type: Entry['type'],
) {
  const notes = new Map<string, { note: string; count: number; lastUsed: number }>();
  if (!categoryId) return [];
  for (const entry of entries) {
    if (
      entry.bookId !== bookId ||
      entry.categoryId !== categoryId ||
      entry.type !== type ||
      entry.deletedAt
    )
      continue;
    const note = entry.note.trim();
    if (!note) continue;
    const existing = notes.get(note);
    if (existing) {
      existing.count++;
      existing.lastUsed = Math.max(existing.lastUsed, entry.updatedAt);
    } else notes.set(note, { note, count: 1, lastUsed: entry.updatedAt });
  }
  return [...notes.values()].sort(
    (a, b) => b.count - a.count || b.lastUsed - a.lastUsed || a.note.localeCompare(b.note, 'zh-CN'),
  );
}

// Reordering is restricted to one book, type and pinned group.
export function moveCategory(s: State, id: string, targetId: string) {
  const item = s.categories.find((c) => c.id === id);
  const target = s.categories.find((c) => c.id === targetId);
  if (
    !item ||
    !target ||
    item.bookId !== target.bookId ||
    item.type !== target.type ||
    !!item.pinned !== !!target.pinned
  )
    return;
  writableBook(s, item.bookId);
  const from = s.categories.indexOf(item),
    to = s.categories.indexOf(target);
  s.categories.splice(from, 1);
  s.categories.splice(to, 0, item);
  touch(s, item.bookId);
}

export function quickDate(timezone: string, daysAgo: number, now?: Date) {
  const local = localTime(timezone, now);
  const date = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10) + local.slice(10);
}

export function backupDue(s: State, bookId: string, now = Date.now()) {
  const book = s.books.find((b) => b.id === bookId && !b.deletedAt);
  if (!book) return false;
  const lastBackup = s.backups[bookId];
  return (
    now - (lastBackup ?? book.createdAt) >= 7 * 86400000 &&
    s.entries.some((e) => e.bookId === bookId && e.updatedAt > (lastBackup ?? 0))
  );
}
