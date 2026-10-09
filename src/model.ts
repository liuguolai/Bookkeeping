import { z } from 'zod';
import { CURRENCIES, type Currency } from './money';

export const currencySchema = z.enum(['CNY', 'HKD', 'MOP', 'USD', 'EUR', 'GBP', 'JPY', 'SGD']);
const id = z.string().min(1).max(100);
const stamp = z.number().int().nonnegative();
const name = z.string().trim().min(1).max(20);
const safeAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const bookSchema = z.object({
  id,
  name,
  currency: currencySchema,
  common: z.array(currencySchema).min(1).max(8),
  timezone: z.string().max(80),
  archived: z.boolean(),
  createdAt: stamp,
  updatedAt: stamp,
  deletedAt: stamp.optional(),
});
export const categorySchema = z.object({
  id,
  bookId: id,
  name,
  type: z.enum(['expense', 'income']),
  icon: z.string().max(30),
  active: z.boolean(),
  pinned: z.boolean().optional(),
});
export const paymentSchema = z.object({ id, bookId: id, name, active: z.boolean() });
export const entrySchema = z.object({
  id,
  bookId: id,
  type: z.enum(['expense', 'income', 'refund']),
  currency: currencySchema,
  amount: safeAmount,
  categoryId: id,
  paymentId: id.optional(),
  note: z.string().max(200),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  createdAt: stamp,
  updatedAt: stamp,
  originalId: id.optional(),
  deletedAt: stamp.optional(),
  deletionGroup: id.optional(),
});
export const budgetSchema = z.object({
  bookId: id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  currency: currencySchema,
  amount: safeAmount,
  categories: z.record(z.string(), safeAmount),
});
export const draftSchema = z.object({
  bookId: id,
  id,
  type: z.enum(['expense', 'income']),
  currency: currencySchema,
  amount: z.string().max(40),
  categoryId: z.string(),
  paymentId: z.string(),
  note: z.string().max(200),
  occurredAt: z.string(),
});
export const templateSchema = z.object({
  id,
  bookId: id,
  name,
  type: z.enum(['expense', 'income']),
  currency: currencySchema,
  amount: safeAmount.optional(),
  categoryId: id,
  paymentId: id.optional(),
  note: z.string().max(200),
});
export const stateSchema = z.object({
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  activeBookId: id.nullable(),
  books: z.array(bookSchema).max(20),
  categories: z.array(categorySchema).max(5000),
  payments: z.array(paymentSchema).max(2000),
  entries: z.array(entrySchema).max(200000),
  budgets: z.array(budgetSchema).max(50000),
  drafts: z.array(draftSchema).max(20),
  templates: z.array(templateSchema).max(400),
  restored: z.array(z.string()).max(1000),
  backups: z.record(z.string(), stamp),
});
export type Book = z.infer<typeof bookSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type EntryTemplate = z.infer<typeof templateSchema>;
export type State = z.infer<typeof stateSchema>;
export const emptyState = (): State => ({
  version: 2,
  revision: 0,
  activeBookId: null,
  books: [],
  categories: [],
  payments: [],
  entries: [],
  budgets: [],
  drafts: [],
  templates: [],
  restored: [],
  backups: {},
});
export const uid = () => crypto.randomUUID();
export function localTime(timezone = 'Asia/Shanghai', when = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const v = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value + ':00Z');
  return (
    !isNaN(date.getTime()) &&
    date.toISOString().slice(0, 16) === value &&
    value.slice(0, 4) >= '1900'
  );
}
export function validateState(input: unknown): State {
  // Version 1 had no templates. Unknown future versions are rejected, never downgraded.
  if (input && typeof input === 'object' && 'version' in input && input.version === 1)
    input = { ...input, version: 2, templates: [] };
  const s = stateSchema.parse(input);
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new Error('数据中存在重复标识');
  };
  unique(s.books.map((b) => b.id));
  unique(s.categories.map((c) => c.id));
  unique(s.payments.map((p) => p.id));
  unique(s.entries.map((e) => e.id));
  unique(s.templates.map((t) => t.id));
  unique(s.templates.map((t) => `${t.bookId}/${t.name}`));
  unique(s.budgets.map((b) => `${b.bookId}/${b.month}/${b.currency}`));
  unique(s.drafts.map((d) => d.bookId));
  const books = new Map(s.books.map((b) => [b.id, b]));
  const cats = new Map(s.categories.map((c) => [c.id, c]));
  const payments = new Map(s.payments.map((p) => [p.id, p]));
  const entries = new Map(s.entries.map((e) => [e.id, e]));
  for (const b of s.books) {
    localTime(b.timezone);
    if (!b.common.includes(b.currency) || new Set(b.common).size !== b.common.length)
      throw new Error('默认币种与常用币种不一致');
  }
  if (s.activeBookId && !books.has(s.activeBookId)) throw new Error('当前账本不存在');
  for (const c of [...s.categories, ...s.payments])
    if (!books.has(c.bookId)) throw new Error('分类或支付方式引用了不存在的账本');
  const withinLimit = (amount: number, currency: Currency) => {
    if (amount >= 10 ** (8 + CURRENCIES[currency].precision)) throw new Error('金额超出单笔范围');
  };
  const refunded = new Map<string, number>();
  for (const e of s.entries) {
    if (!books.has(e.bookId) || !validDate(e.occurredAt)) throw new Error('流水账本或日期不合法');
    const cat = cats.get(e.categoryId);
    if (
      !cat ||
      cat.bookId !== e.bookId ||
      cat.type !== (e.type === 'income' ? 'income' : 'expense')
    )
      throw new Error('流水分类不合法');
    if (e.paymentId && payments.get(e.paymentId)?.bookId !== e.bookId)
      throw new Error('支付方式不属于当前账本');
    withinLimit(e.amount, e.currency);
    if (e.type === 'refund') {
      const parent = e.originalId ? entries.get(e.originalId) : undefined;
      if (
        !parent ||
        parent.type !== 'expense' ||
        parent.bookId !== e.bookId ||
        parent.currency !== e.currency ||
        parent.categoryId !== e.categoryId ||
        e.occurredAt < parent.occurredAt
      )
        throw new Error('退款关联、币种或日期不合法');
      if (!e.deletedAt) {
        if (parent.deletedAt) throw new Error('有效退款不能关联已删除支出');
        refunded.set(parent.id, (refunded.get(parent.id) ?? 0) + e.amount);
      }
    } else if (e.originalId) throw new Error('普通流水不能有关联退款字段');
  }
  for (const [originalId, total] of refunded)
    if (total > entries.get(originalId)!.amount) throw new Error('退款总额超过原支出');
  for (const b of s.budgets) {
    if (!books.has(b.bookId)) throw new Error('预算账本不存在');
    withinLimit(b.amount, b.currency);
    let total = 0;
    for (const [catId, amount] of Object.entries(b.categories)) {
      const cat = cats.get(catId);
      if (!cat || cat.bookId !== b.bookId || cat.type !== 'expense')
        throw new Error('预算分类不合法');
      total += amount;
    }
    if (total > b.amount) throw new Error('分类预算之和不能超过总预算');
  }
  for (const d of s.drafts) if (!books.has(d.bookId)) throw new Error('草稿账本不存在');
  for (const t of s.templates) {
    const category = cats.get(t.categoryId);
    if (
      !books.has(t.bookId) ||
      !category ||
      category.bookId !== t.bookId ||
      category.type !== t.type
    )
      throw new Error('模板账本或分类不合法');
    if (t.paymentId && payments.get(t.paymentId)?.bookId !== t.bookId)
      throw new Error('模板支付方式不属于当前账本');
    if (t.amount !== undefined) withinLimit(t.amount, t.currency);
  }
  return s;
}
