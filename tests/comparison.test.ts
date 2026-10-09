import { expect, it } from 'vitest';
import { emptyState, uid, type Entry } from '../src/model';
import { createBook } from '../src/domain';
import { monthComparison, previousMonth, changeText } from '../src/comparison';
function fixture() {
  const s = emptyState(),
    b = createBook(s, '日常', 'CNY');
  const add = (type: Entry['type'], amount: number, date: string, extra: Partial<Entry> = {}) => {
    const e: Entry = {
      id: uid(),
      bookId: b.id,
      type,
      amount,
      currency: 'CNY',
      categoryId: s.categories.find((c) => c.type === (type === 'income' ? 'income' : 'expense'))!
        .id,
      note: '',
      occurredAt: date + 'T12:00',
      createdAt: 1,
      updatedAt: 1,
      ...extra,
    };
    s.entries.push(e);
    return e;
  };
  return { s, b, add };
}
it('compares calendar ranges across years, leap days and shorter months', () => {
  const { s, b } = fixture();
  expect(previousMonth('2026-01')).toBe('2025-12');
  expect(previousMonth('0001-01')).toBeNull();
  expect(monthComparison(s, b.id, 'CNY', '2024-03', true, '2024-03-31').previousEnd).toBe(
    '2024-02-29',
  );
  expect(monthComparison(s, b.id, 'CNY', '2025-03', true, '2025-03-31').previousEnd).toBe(
    '2025-02-28',
  );
  expect(monthComparison(s, b.id, 'CNY', '2024-02', false, '2024-03-31').end).toBe('2024-02-29');
  expect(monthComparison(s, b.id, 'CNY', '0001-01', true, '2026-10-09').previousEnd).toBeNull();
});
it('compares current month through today and lets full-month mode include the rest of the prior month', () => {
  const { s, b, add } = fixture();
  add('expense', 1000, '2026-10-09');
  add('expense', 300, '2026-09-09');
  add('expense', 700, '2026-09-10');
  const partial = monthComparison(s, b.id, 'CNY', '2026-10', true, '2026-10-09');
  expect(partial.current.net).toBe(1000);
  expect(partial.prior.net).toBe(300);
  expect(partial.end).toBe('2026-10-09');
  expect(monthComparison(s, b.id, 'CNY', '2026-10', false, '2026-10-09').prior.net).toBe(1000);
  expect(monthComparison(s, b.id, 'CNY', '2026-09', true, '2026-10-09').current.net).toBe(1000);
});
it('isolates books and currencies and excludes deleted records', () => {
  const { s, b, add } = fixture(),
    other = createBook(s, '旅行', 'JPY');
  add('expense', 1230, '2026-10-01');
  add('expense', 900, '2026-10-01', { currency: 'JPY' });
  add('expense', 50000, '2026-10-01', { bookId: other.id });
  add('expense', 4000, '2026-10-01', { deletedAt: 1 });
  expect(monthComparison(s, b.id, 'CNY', '2026-10', false).current.net).toBe(1230);
  expect(monthComparison(s, b.id, 'JPY', '2026-10', false).current.net).toBe(900);
});
it('attributes cross-month refunds to refund date and keeps negative net spending', () => {
  const { s, b, add } = fixture();
  const expense = add('expense', 10000, '2026-09-08');
  add('refund', 5000, '2026-10-08', { originalId: expense.id });
  add('income', 8000, '2026-10-08');
  const c = monthComparison(s, b.id, 'CNY', '2026-10', true, '2026-10-09');
  expect(c.current).toMatchObject({ income: 8000, net: -5000, refunds: 5000, balance: 13000 });
  expect(c.prior.net).toBe(10000);
  expect(c.categories.find((x) => x.type === 'expense')).toMatchObject({
    current: -5000,
    previous: 10000,
    difference: -15000,
  });
});
it('includes categories only present in prior month and disabled categories, sorted by absolute change', () => {
  const { s, b, add } = fixture();
  add('expense', 10000, '2026-09-01');
  const second = s.categories[1];
  add('expense', 2000, '2026-10-01', { categoryId: second.id });
  s.categories[0].active = false;
  const rows = monthComparison(s, b.id, 'CNY', '2026-10', false).categories;
  expect(rows[0]).toMatchObject({ active: false, current: 0, previous: 10000, difference: -10000 });
  expect(rows[1].difference).toBe(2000);
});
it('shows budget remainder/overspend from full selected month and floors negative usage at zero', () => {
  const { s, b, add } = fixture();
  add('expense', 12000, '2026-10-01');
  s.budgets.push({
    bookId: b.id,
    currency: 'CNY',
    month: '2026-10',
    amount: 10000,
    categories: {},
  });
  expect(monthComparison(s, b.id, 'CNY', '2026-10', true, '2026-10-09').budget).toEqual({
    amount: 10000,
    used: 12000,
    remaining: -2000,
  });
  expect(monthComparison(s, b.id, 'HKD', '2026-10', false).budget).toBeNull();
  add('refund', 15000, '2026-10-02');
  expect(monthComparison(s, b.id, 'CNY', '2026-10', false).budget?.remaining).toBe(10000);
});
it('formats change without undefined percentages or fractional yen', () => {
  expect(changeText(150, 100, 'JPY', 1)).toBe('增加 JPY 50 · 50.0%');
  expect(changeText(0, 100, 'CNY', 1)).toBe('减少 CNY 1.00 · 100.0%');
  expect(changeText(10, 0, 'CNY', 0)).toContain('上期无记录');
  expect(changeText(10, 0, 'CNY', 2)).toContain('上期为零');
  expect(changeText(0, -100, 'CNY', 1)).toContain('上期为负');
  expect(changeText(100, 100, 'CNY', 1)).toContain('持平');
});
