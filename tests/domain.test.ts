import { describe, it, expect } from 'vitest';
import { emptyState, validateState, uid, localTime, type State } from '../src/model';
import {
  createBook,
  saveEntry,
  summarize,
  saveBudget,
  deleteEntry,
  restoreEntry,
  remainingRefund,
  purgeExpired,
  inheritBudgets,
} from '../src/domain';
import { parseMoney, amountText, money, type Currency } from '../src/money';
function setup() {
  const state = emptyState();
  const book = createBook(state, '测试账本', 'CNY');
  const expense = state.categories.find((c) => c.type === 'expense')!;
  const income = state.categories.find((c) => c.type === 'income')!;
  return { state, book, expense, income };
}
function entry(
  s: State,
  currency: Currency = 'CNY',
  amount = '100',
  type: 'income' | 'expense' = 'expense',
  occurredAt = '2026-01-15T12:00',
) {
  return saveEntry(s, {
    id: uid(),
    bookId: s.books[0].id,
    type,
    currency,
    amount,
    categoryId: s.categories.find((c) => c.type === type)!.id,
    note: '',
    occurredAt,
  });
}
describe('currency precision and isolation', () => {
  it('parses decimal strings exactly without floating point drift', () => {
    expect(parseMoney('0.29', 'CNY')).toBe(29);
    expect(parseMoney('001.01', 'HKD')).toBe(101);
    expect(parseMoney('99999999.99', 'USD')).toBe(9999999999);
    expect(amountText(-101, 'HKD')).toBe('-1.01');
    expect(money(123456, 'CNY')).toBe('CNY 1,234.56');
  });
  it.each(['0', '-1', '1.001', '1e3', 'NaN', 'Infinity', '1,000', '100000000', ''])(
    'rejects invalid amount %s',
    (value) => expect(() => parseMoney(value, 'CNY')).toThrow(),
  );
  it('treats JPY as integer units', () => {
    expect(parseMoney('1200', 'JPY')).toBe(1200);
    expect(amountText(1200, 'JPY')).toBe('1200');
    expect(() => parseMoney('12.50', 'JPY')).toThrow();
  });
  it('never combines currencies into a summary', () => {
    const { state } = setup();
    entry(state);
    entry(state, 'HKD');
    entry(state, 'CNY', '200', 'income');
    expect(summarize(state.entries, 'CNY')).toMatchObject({
      net: 10000,
      income: 20000,
      balance: 10000,
      count: 2,
    });
    expect(summarize(state.entries, 'HKD').net).toBe(10000);
  });
  it('default currency changes do not relabel existing entries', () => {
    const { state, book } = setup();
    entry(state);
    book.currency = 'HKD';
    expect(state.entries[0].currency).toBe('CNY');
    expect(validateState(state).books[0].currency).toBe('HKD');
  });
  it('prevents currency changes while editing', () => {
    const { state } = setup();
    const e = entry(state);
    expect(() => saveEntry(state, { ...e, amount: '100', currency: 'HKD' }, true)).toThrow('币种');
  });
  it('retains a category history after deactivation', () => {
    const { state, expense } = setup();
    entry(state);
    expense.active = false;
    expect(validateState(state).entries).toHaveLength(1);
    expect(() => entry(state)).toThrow('有效分类');
  });
});
describe('refund lifecycle', () => {
  it('partially refunds, enforces original currency and prevents excess', () => {
    const { state } = setup();
    const original = entry(state, 'HKD', '200');
    const input = {
      id: uid(),
      bookId: original.bookId,
      type: 'refund' as const,
      currency: 'HKD' as const,
      amount: '50',
      categoryId: original.categoryId,
      note: '',
      occurredAt: '2026-02-01T12:00',
      originalId: original.id,
    };
    saveEntry(state, input);
    expect(remainingRefund(state, original)).toBe(15000);
    expect(() => saveEntry(state, { ...input, id: uid(), currency: 'CNY' })).toThrow('同币种');
    expect(() => saveEntry(state, { ...input, id: uid(), amount: '151' })).toThrow('剩余');
    expect(
      summarize(
        state.entries.filter((e) => e.occurredAt.startsWith('2026-01')),
        'HKD',
      ).net,
    ).toBe(20000);
    expect(
      summarize(
        state.entries.filter((e) => e.occurredAt.startsWith('2026-02')),
        'HKD',
      ),
    ).toMatchObject({ net: -5000, income: 0, balance: 5000 });
  });
  it('rejects refund before purchase and reducing expense below refunded amount', () => {
    const { state } = setup();
    const e = entry(state);
    const refund = { ...e, id: uid(), type: 'refund' as const, originalId: e.id, amount: '80' };
    expect(() => saveEntry(state, { ...refund, occurredAt: '2026-01-01T12:00' })).toThrow('早于');
    saveEntry(state, refund);
    expect(() => saveEntry(state, { ...e, amount: '79' }, true)).toThrow('已退款');
  });
  it('deletes and restores linked refunds together', () => {
    const { state } = setup();
    const e = entry(state);
    saveEntry(state, { ...e, id: uid(), type: 'refund', originalId: e.id, amount: '20' });
    deleteEntry(state, e.id);
    expect(summarize(state.entries, 'CNY').count).toBe(0);
    restoreEntry(state, e.id);
    expect(summarize(validateState(state).entries, 'CNY').net).toBe(8000);
  });
  it('rejects restoring an old refund when another one uses the remaining amount', () => {
    const { state } = setup();
    const e = entry(state);
    const r = saveEntry(state, {
      ...e,
      id: uid(),
      type: 'refund',
      originalId: e.id,
      amount: '100',
    });
    deleteEntry(state, r.id);
    saveEntry(state, { ...e, id: uid(), type: 'refund', originalId: e.id, amount: '100' });
    restoreEntry(state, r.id);
    expect(() => validateState(state)).toThrow('退款总额');
  });
  it('propagates edited expense category to refunds', () => {
    const { state } = setup();
    const e = entry(state);
    saveEntry(state, { ...e, id: uid(), type: 'refund', originalId: e.id, amount: '20' });
    const other = state.categories.filter((c) => c.type === 'expense')[1];
    saveEntry(state, { ...e, amount: '100', categoryId: other.id }, true);
    expect(state.entries.every((x) => x.categoryId === other.id)).toBe(true);
    expect(() => validateState(state)).not.toThrow();
  });
});
describe('ledger constraints and budget', () => {
  it('is idempotent for duplicate saves and detects stale edits', () => {
    const { state } = setup();
    const e = entry(state);
    saveEntry(state, { ...e, amount: '100' });
    expect(state.entries).toHaveLength(1);
    expect(() => saveEntry(state, { ...e, amount: '101' }, true, 1)).toThrow('另一页面');
  });
  it('rejects invalid date, future date and archived writes', () => {
    const { state, book } = setup();
    expect(() => entry(state, 'CNY', '100', 'expense', '2026-02-30T00:00')).toThrow('日期');
    expect(() => entry(state, 'CNY', '100', 'expense', '2099-01-01T00:00')).toThrow('日期');
    book.archived = true;
    expect(() => entry(state)).toThrow('归档');
  });
  it('keeps budgets independent by book, month and currency', () => {
    const { state, book } = setup();
    saveBudget(state, {
      bookId: book.id,
      currency: 'CNY',
      month: '2026-01',
      amount: 10000,
      categories: {},
    });
    saveBudget(state, {
      bookId: book.id,
      currency: 'HKD',
      month: '2026-01',
      amount: 20000,
      categories: {},
    });
    saveBudget(state, {
      bookId: book.id,
      currency: 'CNY',
      month: '2026-01',
      amount: 15000,
      categories: {},
    });
    expect(state.budgets).toHaveLength(2);
    expect(state.budgets.find((b) => b.currency === 'HKD')?.amount).toBe(20000);
  });
  it('rejects category budgets over total', () => {
    const { state, book, expense } = setup();
    expect(() =>
      saveBudget(state, {
        bookId: book.id,
        currency: 'CNY',
        month: '2026-01',
        amount: 100,
        categories: { [expense.id]: 101 },
      }),
    ).toThrow('分类预算');
  });
  it('inherits each currency without inactive categories or intermediate months', () => {
    const { state, book, expense } = setup();
    saveBudget(state, {
      bookId: book.id,
      currency: 'HKD',
      month: '2026-01',
      amount: 10000,
      categories: { [expense.id]: 5000 },
    });
    expense.active = false;
    inheritBudgets(state, book.id, '2026-04');
    inheritBudgets(state, book.id, '2026-04');
    expect(state.budgets).toHaveLength(2);
    expect(state.budgets[1]).toMatchObject({
      month: '2026-04',
      currency: 'HKD',
      amount: 10000,
      categories: {},
    });
  });
  it('purges expired data and keeps ordinary archives', () => {
    const { state, book } = setup();
    const e = entry(state);
    deleteEntry(state, e.id);
    state.entries[0].deletedAt = 1;
    book.archived = true;
    purgeExpired(state);
    expect(state.entries).toHaveLength(0);
    expect(state.books).toHaveLength(1);
  });
  it('keeps calendar dates fixed when displaying different time zones', () => {
    const t = new Date('2026-01-31T18:00:00Z');
    expect(localTime('Asia/Shanghai', t)).toBe('2026-02-01T02:00');
    expect(localTime('America/New_York', t)).toBe('2026-01-31T13:00');
  });
  it('rejects dangling or mismatched category and budget references', () => {
    const { state } = setup();
    const e = entry(state);
    e.categoryId = 'missing';
    expect(() => validateState(state)).toThrow('分类');
  });
});
