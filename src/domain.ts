import { CURRENCIES, addMoney, parseMoney, type Currency } from './money';
import { type State, type Entry, type Book, type Budget, uid, localTime, validDate } from './model';

const expenseCategories = [
  ['餐饮', 'utensils'],
  ['交通', 'train'],
  ['购物', 'shopping'],
  ['住房', 'home'],
  ['生活缴费', 'bolt'],
  ['医疗健康', 'heart'],
  ['教育', 'book'],
  ['娱乐', 'game'],
  ['旅行', 'plane'],
  ['人情往来', 'gift'],
  ['长辈', 'elder'],
  ['小孩', 'baby'],
  ['其他支出', 'dots'],
];
const incomeCategories = [
  ['工资', 'wallet'],
  ['奖金', 'award'],
  ['兼职', 'briefcase'],
  ['其他收入', 'dots'],
];
export function createBook(
  s: State,
  name: string,
  currency: Currency,
  timezone = 'Asia/Shanghai',
): Book {
  if (s.books.length >= 20) throw new Error('最多可创建 20 个账本');
  name = name.trim();
  if (!name || name.length > 20) throw new Error('账本名称需要 1 至 20 个字符');
  if (s.books.some((b) => !b.deletedAt && b.name === name)) throw new Error('已有同名账本');
  localTime(timezone);
  const now = Date.now();
  const b: Book = {
    id: uid(),
    name,
    currency,
    common: Array.from(new Set([currency, 'CNY', 'HKD'])) as Currency[],
    timezone,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  s.books.push(b);
  s.activeBookId = b.id;
  for (const [type, list] of [
    ['expense', expenseCategories],
    ['income', incomeCategories],
  ] as const)
    for (const [name, icon] of list)
      s.categories.push({ id: uid(), bookId: b.id, name, icon, type, active: true });
  for (const name of ['微信', '支付宝', '银行卡', '现金', '其他'])
    s.payments.push({ id: uid(), bookId: b.id, name, active: true });
  return b;
}
export function writableBook(s: State, id: string): Book {
  const b = s.books.find((b) => b.id === id);
  if (!b || b.deletedAt) throw new Error('账本已删除');
  if (b.archived) throw new Error('账本已归档，请先解除归档');
  return b;
}
export function touch(s: State, bookId: string) {
  const b = s.books.find((b) => b.id === bookId);
  if (b) b.updatedAt = Date.now();
}
export function bookEntries(s: State, bookId: string): Entry[] {
  return s.entries.filter((e) => e.bookId === bookId && !e.deletedAt);
}
export function remainingRefund(s: State, original: Entry, excludingId?: string): number {
  return (
    original.amount -
    addMoney(
      s.entries
        .filter(
          (e) =>
            !e.deletedAt &&
            e.type === 'refund' &&
            e.originalId === original.id &&
            e.id !== excludingId,
        )
        .map((e) => e.amount),
    )
  );
}
export interface EntryInput {
  id: string;
  bookId: string;
  type: Entry['type'];
  currency: Currency;
  amount: string;
  categoryId: string;
  paymentId?: string;
  note: string;
  occurredAt: string;
  originalId?: string;
}
export function saveEntry(
  s: State,
  input: EntryInput,
  editing = false,
  expectedUpdatedAt?: number,
): Entry {
  const book = writableBook(s, input.bookId);
  const existing = s.entries.find((e) => e.id === input.id);
  if (existing && !editing) return existing;
  if (editing && (!existing || existing.deletedAt)) throw new Error('这笔记录已删除，请刷新后重试');
  if (existing && expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt)
    throw new Error('记录已在另一页面修改，请重新打开');
  if (
    existing &&
    (existing.currency !== input.currency ||
      existing.bookId !== input.bookId ||
      existing.type !== input.type)
  )
    throw new Error('已保存记录不能更改币种、类型或账本');
  if (
    !validDate(input.occurredAt) ||
    input.occurredAt.slice(0, 10) > localTime(book.timezone).slice(0, 10)
  )
    throw new Error('请选择有效的发生日期，不能晚于今天');
  const amount = parseMoney(input.amount, input.currency);
  if (input.note.length > 200) throw new Error('备注最多 200 个字符');
  let categoryId = input.categoryId;
  if (input.type === 'refund') {
    const parent = s.entries.find(
      (e) => e.id === input.originalId && !e.deletedAt && e.type === 'expense',
    );
    if (!parent || parent.bookId !== book.id || parent.currency !== input.currency)
      throw new Error('退款须关联同账本、同币种的有效支出');
    if (input.occurredAt < parent.occurredAt) throw new Error('退款不能早于原支出');
    if (amount > remainingRefund(s, parent, existing?.id))
      throw new Error('退款金额超过剩余可退金额');
    categoryId = parent.categoryId;
  }
  const cat = s.categories.find(
    (c) =>
      c.id === categoryId &&
      c.bookId === book.id &&
      c.type === (input.type === 'income' ? 'income' : 'expense'),
  );
  if (!cat || (!cat.active && input.type !== 'refund' && existing?.categoryId !== cat.id))
    throw new Error('请选择一个有效分类');
  if (input.paymentId) {
    const payment = s.payments.find((p) => p.id === input.paymentId && p.bookId === book.id);
    const parentPayment = input.originalId
      ? s.entries.find((e) => e.id === input.originalId)?.paymentId
      : undefined;
    if (
      !payment ||
      (!payment.active && existing?.paymentId !== payment.id && parentPayment !== payment.id)
    )
      throw new Error('请选择有效支付方式');
  }
  if (existing?.type === 'expense') {
    if (amount < existing.amount - remainingRefund(s, existing))
      throw new Error('金额不能低于已退款总额');
    if (s.entries.some((e) => e.originalId === existing.id && e.occurredAt < input.occurredAt))
      throw new Error('原支出日期不能晚于其退款日期');
  }
  const now = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
  const result: Entry = {
    ...input,
    amount,
    categoryId,
    paymentId: input.paymentId || undefined,
    note: input.note.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (existing) s.entries[s.entries.indexOf(existing)] = result;
  else s.entries.push(result);
  if (result.type === 'expense')
    for (const e of s.entries) if (e.originalId === result.id) e.categoryId = result.categoryId;
  s.drafts = s.drafts.filter((d) => d.id !== result.id);
  touch(s, book.id);
  return result;
}
export function deleteEntry(s: State, id: string) {
  const e = s.entries.find((e) => e.id === id && !e.deletedAt);
  if (!e) throw new Error('记录不存在');
  writableBook(s, e.bookId);
  const now = Date.now();
  for (const item of s.entries)
    if (!item.deletedAt && (item.id === id || item.originalId === id)) {
      item.deletedAt = now;
      item.deletionGroup = id;
      item.updatedAt = now;
    }
  touch(s, e.bookId);
}
export function restoreEntry(s: State, id: string) {
  const e = s.entries.find((e) => e.id === id && e.deletedAt);
  if (!e) throw new Error('记录已恢复或已过期');
  writableBook(s, e.bookId);
  const group = s.entries.filter(
    (x) => x.deletedAt && (x.id === id || (e.type === 'expense' && x.deletionGroup === e.id)),
  );
  if (group.some((x) => Date.now() - x.deletedAt! >= 30 * 86400000))
    throw new Error('记录已超过 30 天恢复期');
  for (const item of group) {
    delete item.deletedAt;
    delete item.deletionGroup;
    item.updatedAt = Date.now();
  }
  // Referential and total refund constraints are validated before repository commit.
  touch(s, e.bookId);
}
export function purgeExpired(s: State, now = Date.now()) {
  const removedBooks = new Set(
    s.books.filter((b) => b.deletedAt && now - b.deletedAt >= 7 * 86400000).map((b) => b.id),
  );
  s.books = s.books.filter((b) => !removedBooks.has(b.id));
  const expired = new Set(
    s.entries
      .filter(
        (e) => removedBooks.has(e.bookId) || (e.deletedAt && now - e.deletedAt >= 30 * 86400000),
      )
      .map((e) => e.id),
  );
  s.entries = s.entries.filter(
    (e) => !expired.has(e.id) && !(e.originalId && expired.has(e.originalId)),
  );
  s.categories = s.categories.filter((c) => !removedBooks.has(c.bookId));
  s.payments = s.payments.filter((p) => !removedBooks.has(p.bookId));
  s.budgets = s.budgets.filter((b) => !removedBooks.has(b.bookId));
  s.drafts = s.drafts.filter((d) => !removedBooks.has(d.bookId));
  s.templates = s.templates.filter((t) => !removedBooks.has(t.bookId));
  for (const id of removedBooks) delete s.backups[id];
  if (!s.books.some((b) => b.id === s.activeBookId && !b.deletedAt))
    s.activeBookId = s.books.find((b) => !b.deletedAt)?.id ?? null;
}
export function summarize(entries: Entry[], currency: Currency) {
  const rows = entries.filter((e) => !e.deletedAt && e.currency === currency);
  const income = addMoney(rows.filter((e) => e.type === 'income').map((e) => e.amount));
  const expense = addMoney(rows.filter((e) => e.type === 'expense').map((e) => e.amount));
  const refunds = addMoney(rows.filter((e) => e.type === 'refund').map((e) => e.amount));
  return {
    income,
    expense,
    refunds,
    net: expense - refunds,
    balance: income - expense + refunds,
    count: rows.length,
  };
}
export function saveBudget(s: State, budget: Budget) {
  writableBook(s, budget.bookId);
  if (Object.values(budget.categories).reduce((a, b) => a + b, 0) > budget.amount)
    throw new Error('分类预算之和不能超过总预算');
  s.budgets = s.budgets.filter(
    (b) =>
      !(b.bookId === budget.bookId && b.month === budget.month && b.currency === budget.currency),
  );
  s.budgets.push(budget);
  touch(s, budget.bookId);
}
export function inheritBudgets(s: State, bookId: string, month: string) {
  const book = s.books.find((b) => b.id === bookId);
  if (!book || book.deletedAt || book.archived) return;
  for (const currency of Object.keys(CURRENCIES) as Currency[]) {
    if (s.budgets.some((b) => b.bookId === bookId && b.month === month && b.currency === currency))
      continue;
    const previous = s.budgets
      .filter((b) => b.bookId === bookId && b.currency === currency && b.month < month)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
    if (previous) {
      s.budgets.push({
        ...previous,
        month,
        categories: Object.fromEntries(
          Object.entries(previous.categories).filter(([id]) =>
            s.categories.some((c) => c.id === id && c.active),
          ),
        ),
      });
      touch(s, bookId);
    }
  }
}
