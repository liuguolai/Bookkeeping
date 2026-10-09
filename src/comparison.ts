import { type State, type Entry, localTime } from './model';
import { summarize } from './domain';
import { addMoney, money, type Currency } from './money';

export function previousMonth(month: string): string | null {
  if (month === '0001-01') return null;
  const year = Number(month.slice(0, 4)),
    m = Number(month.slice(5));
  return m === 1
    ? `${String(year - 1).padStart(4, '0')}-12`
    : `${month.slice(0, 4)}-${String(m - 1).padStart(2, '0')}`;
}
function daysInMonth(month: string) {
  const y = Number(month.slice(0, 4)),
    m = Number(month.slice(5));
  return m === 2
    ? y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(m)
      ? 30
      : 31;
}
export function monthComparison(
  s: State,
  bookId: string,
  currency: Currency,
  month: string,
  samePeriod: boolean,
  today?: string,
) {
  const book = s.books.find((b) => b.id === bookId);
  if (!book) throw new Error('账本不存在');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000'))
    throw new Error('月份无效');
  const date = today ?? localTime(book.timezone).slice(0, 10);
  const previous = previousMonth(month);
  const partial = samePeriod && month === date.slice(0, 7);
  const day = partial ? Number(date.slice(8, 10)) : daysInMonth(month);
  const end = `${month}-${String(day).padStart(2, '0')}`;
  const previousEnd = previous
    ? `${previous}-${String(partial ? Math.min(day, daysInMonth(previous)) : daysInMonth(previous)).padStart(2, '0')}`
    : null;
  const rows = s.entries.filter(
    (e) => e.bookId === bookId && e.currency === currency && !e.deletedAt,
  );
  const currentRows = rows.filter(
    (e) => e.occurredAt.startsWith(month) && e.occurredAt.slice(0, 10) <= end,
  );
  const previousRows = previous
    ? rows.filter(
        (e) => e.occurredAt.startsWith(previous) && e.occurredAt.slice(0, 10) <= previousEnd!,
      )
    : [];
  const totals = (items: Entry[]) => {
    const result = new Map<string, { value: number; count: number }>();
    for (const e of items) {
      const existing = result.get(e.categoryId) ?? { value: 0, count: 0 };
      result.set(e.categoryId, {
        value: addMoney([existing.value, e.type === 'refund' ? -e.amount : e.amount]),
        count: existing.count + 1,
      });
    }
    return result;
  };
  const a = totals(currentRows),
    b = totals(previousRows);
  const categories = s.categories
    .filter((c) => c.bookId === bookId && (a.has(c.id) || b.has(c.id)))
    .map((c) => {
      const current = a.get(c.id)?.value ?? 0,
        previous = b.get(c.id)?.value ?? 0;
      return {
        ...c,
        current,
        previous,
        previousCount: b.get(c.id)?.count ?? 0,
        difference: addMoney([current, -previous]),
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.difference) - Math.abs(a.difference) || a.name.localeCompare(b.name, 'zh-CN'),
    );
  const budget = s.budgets.find(
    (b) => b.bookId === bookId && b.currency === currency && b.month === month,
  );
  const used = Math.max(
    0,
    summarize(
      rows.filter((e) => e.occurredAt.startsWith(month)),
      currency,
    ).net,
  );
  return {
    month,
    previous,
    end,
    previousEnd,
    partial,
    current: summarize(currentRows, currency),
    prior: summarize(previousRows, currency),
    categories,
    budget: budget
      ? { amount: budget.amount, used, remaining: addMoney([budget.amount, -used]) }
      : null,
  };
}
export function changeText(
  current: number,
  previous: number,
  currency: Currency,
  previousCount: number,
) {
  const delta = addMoney([current, -previous]);
  const amount =
    delta === 0 ? '持平' : `${delta > 0 ? '增加' : '减少'} ${money(Math.abs(delta), currency)}`;
  const percent =
    previousCount === 0
      ? '上期无记录'
      : previous === 0
        ? '上期为零'
        : previous < 0
          ? '上期为负'
          : `${((Math.abs(delta) / previous) * 100).toFixed(1)}%`;
  return `${amount} · ${percent}`;
}
