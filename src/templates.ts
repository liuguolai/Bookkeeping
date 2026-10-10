import { t } from './i18n';
import { type EntryTemplate, type State, templateSchema } from './model';
import { touch, writableBook } from './domain';
import { CURRENCIES } from './money';

export function saveTemplate(s: State, input: EntryTemplate, editing = false) {
  const value = templateSchema.parse({
    ...input,
    name: input.name.trim(),
    note: input.note.trim(),
  });
  writableBook(s, value.bookId);
  const existing = s.templates.find((t) => t.id === value.id);
  if (editing && (!existing || existing.bookId !== value.bookId))
    throw new Error(t('模板已不存在，请重新打开'));
  if (!editing && existing) throw new Error(t('模板已存在'));
  if (!editing && s.templates.filter((t) => t.bookId === value.bookId).length >= 20)
    throw new Error(t('每个账本最多保存 20 个模板'));
  if (
    s.templates.some((t) => t.bookId === value.bookId && t.id !== value.id && t.name === value.name)
  )
    throw new Error(t('已有同名模板'));
  if (
    !s.categories.some(
      (c) =>
        c.id === value.categoryId && c.bookId === value.bookId && c.type === value.type && c.active,
    )
  )
    throw new Error(t('请选择可用分类'));
  if (
    value.paymentId &&
    !s.payments.some((p) => p.id === value.paymentId && p.bookId === value.bookId && p.active)
  )
    throw new Error(t('请选择可用支付方式'));
  if (
    value.amount !== undefined &&
    value.amount >= 10 ** (8 + CURRENCIES[value.currency].precision)
  )
    throw new Error(t('金额过大'));
  s.templates = [...s.templates.filter((t) => t.id !== value.id), value];
  touch(s, value.bookId);
}
