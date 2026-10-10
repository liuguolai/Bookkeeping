import { t as tr, useLocale } from './i18n';
import { useState } from 'react';
import { useLedger } from './context';
import { type Book, type EntryTemplate, uid } from './model';
import { amountText, calculateMoney, currencyCodes, type Currency } from './money';
import { saveTemplate } from './templates';
import { touch, writableBook } from './domain';
import { Dialog, Label } from './ui';

export function TemplatesDialog({
  book,
  onClose,
  onUse,
}: {
  book: Book;
  onClose: () => void;
  onUse: (t: EntryTemplate) => void;
}) {
  useLocale();
  const { state, run, confirm, notify } = useLedger();
  const [editing, setEditing] = useState<EntryTemplate | 'new' | null>(null);
  const [name, setName] = useState(''),
    [type, setType] = useState<'expense' | 'income'>('expense');
  const [currency, setCurrency] = useState<Currency>(book.currency),
    [amount, setAmount] = useState('');
  const [category, setCategory] = useState(''),
    [payment, setPayment] = useState(''),
    [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const start = (t?: EntryTemplate) => {
    setEditing(t ?? 'new');
    setName(t?.name ?? '');
    setType(t?.type ?? 'expense');
    setCurrency(t?.currency ?? book.currency);
    setAmount(t?.amount === undefined ? '' : amountText(t.amount, t.currency));
    setCategory(t?.categoryId ?? '');
    setPayment(t?.paymentId ?? '');
    setNote(t?.note ?? '');
  };
  const leave = async () => {
    if (busy) return;
    if (
      editing &&
      !(await confirm(tr('放弃模板编辑？'), tr('尚未保存的模板修改会丢失。'), true, tr('放弃编辑')))
    )
      return;
    if (editing) setEditing(null);
    else onClose();
  };
  return (
    <Dialog
      title={editing ? (editing === 'new' ? tr('新建模板') : tr('编辑模板')) : tr('常用模板')}
      onClose={leave}
    >
      <p className="dialog-copy">
        {book.name}
        {tr(' · 模板按账本和币种保存。使用时预填，确认后才记入账本。')}
      </p>
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              const value: EntryTemplate = {
                id: editing === 'new' ? uid() : editing.id,
                bookId: book.id,
                name,
                type,
                currency,
                amount: amount.trim() ? calculateMoney(amount, currency) : undefined,
                categoryId: category,
                paymentId: payment || undefined,
                note,
              };
              if (await run((s) => saveTemplate(s, value, editing !== 'new'), tr('模板已保存')))
                setEditing(null);
            } catch (error) {
              notify((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Label title={tr('模板名称')}>
            <input
              aria-label={tr('模板名称')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              required
              autoFocus
            />
          </Label>
          <div className="form-grid">
            <Label title={tr('收支类型')}>
              <select
                aria-label={tr('模板类型')}
                value={type}
                onChange={(e) => {
                  setType(e.target.value as typeof type);
                  setCategory('');
                }}
              >
                <option value="expense">{tr('支出')}</option>
                <option value="income">{tr('收入')}</option>
              </select>
            </Label>
            <Label title={tr('币种')}>
              <select
                aria-label={tr('模板币种')}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {currencyCodes.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Label>
          </div>
          <Label
            title={tr('固定金额 · 选填')}
            hint={tr('留空则每次输入；支持加减算式。更换币种不会换算金额。')}
          >
            <input
              aria-label={tr('模板金额')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              maxLength={40}
            />
          </Label>
          <Label title={tr('分类')}>
            <select
              aria-label={tr('模板分类')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
            >
              <option value="">{tr('请选择')}</option>
              {state.categories
                .filter(
                  (c) => c.bookId === book.id && c.type === type && (c.active || c.id === category),
                )
                .map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.active}>
                    {c.name}
                    {!c.active ? tr('（已停用）') : ''}
                  </option>
                ))}
            </select>
          </Label>
          <Label title={tr('支付方式 · 选填')}>
            <select
              aria-label={tr('模板支付方式')}
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
            >
              <option value="">{tr('未填写')}</option>
              {state.payments
                .filter((p) => p.bookId === book.id && (p.active || p.id === payment))
                .map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.active}>
                    {p.name}
                    {!p.active ? tr('（已停用）') : ''}
                  </option>
                ))}
            </select>
          </Label>
          <Label title={tr('备注 · 选填')}>
            <input
              aria-label={tr('模板备注')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </Label>
          <div className="actions">
            <button type="button" className="secondary" onClick={leave} disabled={busy}>
              {tr('返回列表')}
            </button>
            <button className="primary" disabled={busy}>
              {tr('保存模板')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <button className="primary wide" disabled={book.archived} onClick={() => start()}>
            {tr('新建模板')}
          </button>
          <div className="template-list">
            {!state.templates.some((t) => t.bookId === book.id) && (
              <p className="dialog-copy">
                {tr('还没有模板。可以保存早餐、通勤、房租等常用记录。')}
              </p>
            )}
            {state.templates
              .filter((t) => t.bookId === book.id)
              .map((t) => (
                <article className="template-card" key={t.id}>
                  <h3>{t.name}</h3>
                  <p>
                    {t.type === 'income' ? tr('收入') : tr('支出')}· {t.currency}{' '}
                    {t.amount === undefined ? tr('每次填写金额') : amountText(t.amount, t.currency)}
                    · {state.categories.find((c) => c.id === t.categoryId)?.name}
                  </p>
                  <div className="template-actions">
                    <button className="primary" disabled={book.archived} onClick={() => onUse(t)}>
                      {tr('使用模板')}
                    </button>
                    <button className="secondary" disabled={book.archived} onClick={() => start(t)}>
                      {tr('编辑')}
                    </button>
                    <button
                      className="text-button danger-text"
                      disabled={book.archived || busy}
                      onClick={async () => {
                        if (
                          !(await confirm(
                            tr('删除模板？'),
                            tr('删除“{0}”不会影响已有记录。', [t.name]),
                            true,
                            tr('删除模板'),
                          ))
                        )
                          return;
                        setBusy(true);
                        await run((s) => {
                          writableBook(s, book.id);
                          s.templates = s.templates.filter((x) => x.id !== t.id);
                          touch(s, book.id);
                        }, tr('模板已删除'));
                        setBusy(false);
                      }}
                    >
                      {tr('删除')}
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
