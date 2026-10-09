import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLedger } from './context';
import { type Book, type Entry, type Draft, type EntryTemplate, localTime, uid } from './model';
import { amountText, calculateMoney, CURRENCIES, currencyCodes, type Currency } from './money';
import { remainingRefund, saveEntry } from './domain';
import { Dialog, Icon, Label } from './ui';
import { orderedCategories, quickDate, frequentNotes } from './experience';

export function EntryEditor({
  book,
  currency,
  entry,
  refund,
  repeat,
  template,
  onClose,
}: {
  book: Book;
  currency: Currency;
  entry?: Entry;
  refund?: Entry;
  repeat?: Entry;
  template?: EntryTemplate;
  onClose: () => void;
}) {
  const { state, run, confirm, notify } = useLedger();
  const draft =
    !entry && !refund && !repeat && !template
      ? state.drafts.find((d) => d.bookId === book.id)
      : undefined;
  const [type, setType] = useState<Entry['type']>(
    entry?.type ??
      (refund ? 'refund' : (repeat?.type ?? template?.type ?? draft?.type ?? 'expense')),
  );
  const [code, setCode] = useState(
    entry?.currency ??
      refund?.currency ??
      repeat?.currency ??
      template?.currency ??
      draft?.currency ??
      currency,
  );
  const [amount, setAmount] = useState(
    entry
      ? amountText(entry.amount, entry.currency)
      : refund
        ? amountText(remainingRefund(state, refund), refund.currency)
        : repeat
          ? amountText(repeat.amount, repeat.currency)
          : template?.amount !== undefined
            ? amountText(template.amount, template.currency)
            : (draft?.amount ?? ''),
  );
  const amountRef = useRef<HTMLInputElement>(null);
  const amountCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (amountCaret.current === null) return;
    amountRef.current?.setSelectionRange(amountCaret.current, amountCaret.current);
    amountCaret.current = null;
  }, [amount]);
  const [showAmountError, setShowAmountError] = useState(false);
  const hasExpression = /[+＋−－-]/.test(amount);
  const calculation = useMemo(() => {
    try {
      return { value: amountText(calculateMoney(amount, code), code), error: '' };
    } catch (error) {
      return { value: '', error: (error as Error).message };
    }
  }, [amount, code]);
  const insertOperator = (operator: '+' | '-') => {
    const input = amountRef.current;
    if (!input) return;
    const start = input.selectionStart ?? amount.length;
    const end = input.selectionEnd ?? amount.length;
    const prefix = amount.slice(0, start).replace(/[+＋−－-]\s*$/, '');
    const next = prefix + operator + amount.slice(end);
    input.focus({ preventScroll: true });
    if (next.length > 40) {
      notify('金额算式最多 40 个字符');
      return;
    }
    if (next === amount) {
      input.setSelectionRange(prefix.length + 1, prefix.length + 1);
    } else {
      amountCaret.current = prefix.length + 1;
      setAmount(next);
    }
    setShowAmountError(false);
  };
  const applyCalculation = () => {
    if (calculation.error) {
      setShowAmountError(true);
    } else {
      if (calculation.value !== amount) amountCaret.current = calculation.value.length;
      setAmount(calculation.value);
      setShowAmountError(false);
    }
    amountRef.current?.focus({ preventScroll: true });
  };
  const [category, setCategory] = useState(
    entry?.categoryId ??
      refund?.categoryId ??
      (repeat && state.categories.find((c) => c.id === repeat.categoryId && c.active)?.id) ??
      (template && state.categories.find((c) => c.id === template.categoryId && c.active)?.id) ??
      draft?.categoryId ??
      '',
  );
  const [date, setDate] = useState(
    entry?.occurredAt ?? draft?.occurredAt ?? localTime(book.timezone),
  );
  const [payment, setPayment] = useState(
    entry?.paymentId ??
      refund?.paymentId ??
      (repeat && state.payments.find((p) => p.id === repeat.paymentId && p.active)?.id) ??
      (template && state.payments.find((p) => p.id === template.paymentId && p.active)?.id) ??
      draft?.paymentId ??
      '',
  );
  const [note, setNote] = useState(
    entry?.note ?? repeat?.note ?? template?.note ?? draft?.note ?? '',
  );
  const [noteLimit, setNoteLimit] = useState(6);
  const noteOptions = useMemo(
    () => frequentNotes(state.entries, book.id, category, type),
    [state.entries, book.id, category, type],
  );
  useEffect(() => setNoteLimit(6), [category, type]);
  const [continued, setContinued] = useState(false);
  const [busy, setBusy] = useState(false),
    [currencyChanged, setCurrencyChanged] = useState(false);
  const id = useRef(entry?.id ?? draft?.id ?? uid());
  const lock = useRef(false);
  const initial = useRef(JSON.stringify([type, code, amount, category, date, payment, note]));
  const dirty =
    ((!!repeat || !!template) && !continued) ||
    JSON.stringify([type, code, amount, category, date, payment, note]) !== initial.current;
  const runRef = useRef(run);
  runRef.current = run;
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (entry || refund || repeat || template || (!amount && !note)) return;
    autosaveTimer.current = setTimeout(() => {
      const value: Draft = {
        id: id.current,
        bookId: book.id,
        type: type as 'income' | 'expense',
        currency: code,
        amount,
        categoryId: category,
        paymentId: payment,
        note,
        occurredAt: date,
      };
      void runRef.current((s) => {
        if (
          s.entries.some((e) => e.id === value.id) ||
          !s.books.some((b) => b.id === value.bookId && !b.deletedAt)
        )
          return;
        s.drafts = [...s.drafts.filter((d) => d.bookId !== book.id), value];
      });
    }, 500);
    return () => clearTimeout(autosaveTimer.current);
  }, [amount, category, code, date, note, payment, type, book.id, entry, refund, repeat, template]);
  const close = async () => {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    if (
      await confirm(
        '离开这笔记录？',
        entry || refund || repeat || template
          ? '这笔记录尚未保存，确定放弃本次修改？'
          : '放弃本次修改将清除这笔新记录的草稿。也可以取消后选择“保存草稿”。',
        true,
        '放弃修改',
      )
    ) {
      clearTimeout(autosaveTimer.current);
      if (!entry && !refund && !repeat && !template)
        await run((s) => {
          s.drafts = s.drafts.filter((d) => d.id !== id.current);
        });
      onClose();
    }
  };
  const saveDraft = async () => {
    const value: Draft = {
      id: id.current,
      bookId: book.id,
      type: type as 'income' | 'expense',
      currency: code,
      amount,
      categoryId: category,
      paymentId: payment,
      note,
      occurredAt: date,
    };
    if (
      await run((s) => {
        s.drafts = [...s.drafts.filter((d) => d.bookId !== book.id), value];
      }, '草稿已保存到本机')
    )
      onClose();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const keepOpen =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute('data-continue') === 'true';
    if (lock.current) return;
    if (calculation.error) {
      setShowAmountError(true);
      notify(calculation.error);
      amountRef.current?.focus();
      return;
    }
    lock.current = true;
    clearTimeout(autosaveTimer.current);
    setBusy(true);
    const ok = await run((s) => {
      saveEntry(
        s,
        {
          id: id.current,
          bookId: book.id,
          type,
          currency: code,
          amount: calculation.value,
          categoryId: category,
          occurredAt: date,
          paymentId: payment || undefined,
          note,
          originalId: entry?.originalId ?? refund?.id,
        },
        !!entry,
        entry?.updatedAt,
      );
    }, '已保存到本机');
    lock.current = false;
    setBusy(false);
    if (ok && keepOpen) {
      id.current = uid();
      setAmount('');
      setNote('');
      setContinued(true);
      initial.current = JSON.stringify([type, code, '', category, date, payment, '']);
      requestAnimationFrame(() => amountRef.current?.focus());
    } else if (ok) onClose();
  };
  return (
    <Dialog
      title={
        entry
          ? '编辑记录'
          : refund
            ? '记录退款'
            : repeat
              ? '再记一笔'
              : template
                ? '使用模板记账'
                : '记一笔'
      }
      onClose={close}
      className="entry-dialog"
    >
      <form onSubmit={submit}>
        <div className="editor-fields">
          {template && (
            <p className="dialog-copy">
              已填入“{template.name}
              ”，日期为今天；确认后才保存，不影响已有草稿。停用的分类和支付方式已留空，请核对。
            </p>
          )}
          {repeat && (
            <p className="dialog-copy">
              已复制原记录，日期更新为今天。确认后才会保存，不影响已有草稿。
            </p>
          )}
          <div className="record-book">
            <Icon name="book" size={16} />
            {book.name}
            <span>本地账本</span>
          </div>
          {type !== 'refund' ? (
            <div className="segmented type-tabs">
              {(['expense', 'income'] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  disabled={!!entry}
                  className={type === t ? 'active' : ''}
                  onClick={() => {
                    setType(t);
                    setCategory('');
                  }}
                >
                  {t === 'expense' ? '支出' : '收入'}
                </button>
              ))}
            </div>
          ) : (
            <div className="notice">
              <Icon name="refund" size={18} />
              退款冲减 {code} 支出，不计入收入
            </div>
          )}
          <div className="amount-input">
            <div className="amount-heading">
              <label htmlFor="entry-amount">金额</label>
              <select
                aria-label="记账币种"
                value={code}
                disabled={!!entry || type === 'refund'}
                onChange={(e) => {
                  setCode(e.target.value as Currency);
                  setCurrencyChanged(!!amount);
                  setShowAmountError(false);
                }}
              >
                {Array.from(new Set([...book.common, ...currencyCodes])).map((c) => (
                  <option key={c} value={c}>
                    {c} · {CURRENCIES[c].name}
                  </option>
                ))}
              </select>
            </div>
            <input
              id="entry-amount"
              ref={amountRef}
              aria-label="金额"
              aria-describedby="amount-calculation-hint"
              aria-invalid={showAmountError && !!calculation.error}
              inputMode={CURRENCIES[code].precision ? 'decimal' : 'numeric'}
              placeholder={CURRENCIES[code].precision ? '0.00' : '0'}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setShowAmountError(false);
              }}
              maxLength={40}
              autoComplete="off"
              autoFocus
              required
            />
            <div className="amount-tools" role="group" aria-label="金额加减计算">
              <button
                type="button"
                aria-label="加一项金额"
                disabled={!amount.trim() || busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertOperator('+')}
              >
                ＋
              </button>
              <button
                type="button"
                aria-label="减一项金额"
                disabled={!amount.trim() || busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertOperator('-')}
              >
                −
              </button>
              <button
                type="button"
                aria-label="计算结果"
                disabled={!amount.trim() || busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={applyCalculation}
              >
                ＝
              </button>
              <button
                type="button"
                disabled={!amount || busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setAmount('');
                  setShowAmountError(false);
                  amountRef.current?.focus({ preventScroll: true });
                }}
              >
                清空
              </button>
            </div>
            <p
              id="amount-calculation-hint"
              className={`amount-hint ${showAmountError && calculation.error ? 'amount-error' : ''}`}
              aria-live="polite"
            >
              {showAmountError && calculation.error
                ? calculation.error
                : hasExpression && !calculation.error
                  ? `合计 ${code} ${calculation.value} · 保存时自动计算`
                  : '支持加减，如 18+12.5；保存时自动计算'}
            </p>
          </div>
          {currencyChanged && <p className="inline-note">已更换币种，金额未换算，请核对。</p>}
          <div className="field">
            <span>选择分类</span>
            <div className="category-grid">
              {orderedCategories(
                state.categories.filter(
                  (c) =>
                    c.bookId === book.id &&
                    c.type === (type === 'income' ? 'income' : 'expense') &&
                    (c.active || c.id === category),
                ),
              ).map((c) => (
                <button
                  type="button"
                  key={c.id}
                  disabled={type === 'refund'}
                  aria-pressed={category === c.id}
                  className={`category-pick ${category === c.id ? 'selected' : ''}`}
                  onClick={() => setCategory(c.id)}
                >
                  <span>
                    <Icon name={c.icon} />
                  </span>
                  {c.pinned && <span className="pinned-label">常用</span>}
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <div>
              <Label title="发生时间">
                <input
                  type="datetime-local"
                  aria-label="发生时间"
                  value={date}
                  max={localTime(book.timezone).slice(0, 10) + 'T23:59'}
                  min="1900-01-01T00:00"
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </Label>
              <div className="quick-dates" role="group" aria-label="快捷日期">
                {['今天', '昨天', '前天'].map((label, index) => (
                  <button
                    type="button"
                    key={label}
                    aria-pressed={
                      date.slice(0, 10) === quickDate(book.timezone, index).slice(0, 10)
                    }
                    onClick={() => setDate(quickDate(book.timezone, index))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Label title="支付方式 · 选填">
              <select
                aria-label="支付方式"
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                <option value="">未填写</option>
                {state.payments
                  .filter((p) => p.bookId === book.id && (p.active || p.id === payment))
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Label>
          </div>
          <Label title="备注 · 选填">
            <input
              aria-label="备注"
              placeholder="为这笔记录留一点细节"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Label>
          {noteOptions.length > 0 && (
            <div className="note-suggestions" role="group" aria-label="常用备注">
              <div className="note-suggestions-heading">
                <span>常用备注</span>
                <small>按使用次数排序，点击填入</small>
              </div>
              <div className="note-options">
                {noteOptions.slice(0, noteLimit).map((option) => (
                  <button
                    type="button"
                    key={option.note}
                    aria-label={`使用备注：${option.note}`}
                    aria-pressed={note === option.note}
                    onClick={() => setNote(option.note)}
                  >
                    <span>{option.note}</span>
                    <small>{option.count} 次</small>
                  </button>
                ))}
              </div>
              {noteOptions.length > 6 && (
                <div className="note-options-actions">
                  {noteLimit < noteOptions.length && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setNoteLimit((limit) => limit + 6)}
                    >
                      更多备注
                    </button>
                  )}
                  {noteLimit > 6 && (
                    <button type="button" className="text-button" onClick={() => setNoteLimit(6)}>
                      收起备注
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="actions editor-actions">
          {!entry && !refund && !repeat && !template && (
            <button type="button" className="secondary" onClick={saveDraft} disabled={busy}>
              保存草稿
            </button>
          )}
          {!entry && !refund && (
            <button type="submit" data-continue="true" className="secondary" disabled={busy}>
              保存并继续
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存记录'}
            <Icon name="check" size={18} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
