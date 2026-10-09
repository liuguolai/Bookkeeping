import { expect, it } from 'vitest';
import {
  backupDue,
  moveCategory,
  orderedCategories,
  quickDate,
  frequentNotes,
} from '../src/experience';
import { emptyState, uid, validateState } from '../src/model';
import { createBook, saveEntry } from '../src/domain';
import { encryptBackup, decryptBackup, restoreBackup } from '../src/backup';

it('frequent notes count saved records in the same book, category and type with recent ties first', () => {
  const s = emptyState(),
    b = createBook(s, '日常', 'CNY');
  const input = {
    bookId: b.id,
    type: 'expense' as const,
    amount: '10',
    currency: 'CNY' as const,
    categoryId: s.categories[0].id,
    note: '午餐',
    occurredAt: '2026-01-01T12:00',
  };
  const add = (note: string, updatedAt: number, extra = {}) => {
    const entry = saveEntry(s, { ...input, ...extra, id: uid(), note });
    entry.updatedAt = updatedAt;
    return entry;
  };
  const lunch = add('午餐', 1);
  add(' 午餐 ', 2, { currency: 'HKD' });
  add('咖啡', 10);
  add('早餐', 9);
  add(' ', 20);
  const deleted = add('不应出现', 21);
  deleted.deletedAt = 22;
  add('其他分类', 25, { categoryId: s.categories[1].id });
  const other = createBook(s, '旅行', 'CNY');
  add('其他账本', 26, {
    bookId: other.id,
    categoryId: s.categories.find((c) => c.bookId === other.id)!.id,
  });
  add('退款备注', 27, { type: 'refund', originalId: lunch.id, amount: '1' });
  expect(
    frequentNotes(s.entries, b.id, input.categoryId, 'expense').map((x) => [x.note, x.count]),
  ).toEqual([
    ['午餐', 2],
    ['咖啡', 1],
    ['早餐', 1],
  ]);
  lunch.note = '早餐';
  expect(frequentNotes(s.entries, b.id, input.categoryId, 'expense')[0]).toMatchObject({
    note: '早餐',
    count: 2,
  });
  expect(frequentNotes(s.entries, b.id, '', 'expense')).toEqual([]);
});

it('quick dates follow book timezone over year and leap-day boundaries', () => {
  expect(quickDate('Asia/Shanghai', 1, new Date('2025-12-31T17:20:00Z'))).toBe('2025-12-31T01:20');
  expect(quickDate('Asia/Shanghai', 1, new Date('2024-03-01T04:00:00Z'))).toBe('2024-02-29T12:00');
  expect(quickDate('America/Los_Angeles', 0, new Date('2026-01-01T01:00:00Z'))).toBe(
    '2025-12-31T17:00',
  );
});

it('backup reminder requires overdue time and unbacked-up records', () => {
  const s = emptyState(),
    b = createBook(s, '日常', 'CNY');
  const now = Date.now();
  b.createdAt = now - 8 * 86400000;
  expect(backupDue(s, b.id, now)).toBe(false);
  const e = saveEntry(s, {
    id: uid(),
    bookId: b.id,
    type: 'expense',
    amount: '10',
    currency: 'CNY',
    categoryId: s.categories[0].id,
    note: '',
    occurredAt: '2026-01-01T12:00',
  });
  expect(backupDue(s, b.id, now)).toBe(true);
  s.backups[b.id] = now - 86400000;
  expect(backupDue(s, b.id, now)).toBe(false);
  s.backups[b.id] = now - 8 * 86400000;
  e.updatedAt = now - 9 * 86400000;
  expect(backupDue(s, b.id, now)).toBe(false);
  e.updatedAt = now;
  expect(backupDue(s, b.id, now)).toBe(true);
});

it('saving an unrelated record does not erase a pending draft', () => {
  const s = emptyState(),
    b = createBook(s, '日常', 'CNY');
  const draft = {
    id: uid(),
    bookId: b.id,
    type: 'expense' as const,
    currency: 'CNY' as const,
    amount: '88',
    categoryId: s.categories[0].id,
    paymentId: '',
    note: '',
    occurredAt: '2026-01-01T12:00',
  };
  s.drafts.push(draft);
  saveEntry(s, { ...draft, id: uid(), amount: '25' });
  expect(s.drafts).toHaveLength(1);
  saveEntry(s, draft);
  expect(s.drafts).toHaveLength(0);
});

it('category reorder stays inside book, type and pinned group', () => {
  const s = emptyState(),
    b = createBook(s, '日常', 'CNY');
  const [a, c] = s.categories;
  a.pinned = true;
  moveCategory(s, a.id, c.id);
  expect(s.categories[0].id).toBe(a.id);
  c.pinned = true;
  moveCategory(s, a.id, c.id);
  expect(orderedCategories(s.categories)[0].id).toBe(c.id);
  const other = createBook(s, '旅行', 'HKD');
  const snapshot = JSON.stringify(s.categories);
  moveCategory(s, a.id, s.categories.find((x) => x.bookId === other.id)!.id);
  moveCategory(s, a.id, s.categories.find((x) => x.bookId === b.id && x.type === 'income')!.id);
  expect(JSON.stringify(s.categories)).toBe(snapshot);
  b.archived = true;
  expect(() => moveCategory(s, a.id, c.id)).toThrow();
});

it('old categories remain readable and backup round-trip retains favorites and order', async () => {
  const s = emptyState(),
    b = createBook(s, '日常', 'CNY');
  expect(validateState(s).categories[0].pinned).toBeUndefined();
  s.categories[1].pinned = true;
  const preview = await decryptBackup(
    await encryptBackup(s, [b.id], 'test-password'),
    'test-password',
  );
  const target = emptyState();
  restoreBackup(target, preview);
  expect(target.categories.map((c) => [c.name, c.pinned])).toEqual(
    s.categories.map((c) => [c.name, c.pinned]),
  );
});
