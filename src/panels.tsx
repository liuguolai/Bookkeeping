import { PwaPanel } from './PwaPanel';
import { WebExport, type PreparedExport } from './WebExport';
import { isNative } from './storage';
import { ProtectionPanel } from './ProtectionPanel';
import { useRef, useState } from 'react';
import { useLedger } from './context';
import { type Book, type Budget, type Entry, uid, localTime } from './model';
import { CURRENCIES, currencyCodes, money, amountText, parseMoney, type Currency } from './money';
import {
  createBook,
  saveBudget,
  touch,
  writableBook,
  deleteEntry,
  remainingRefund,
  restoreEntry,
  summarize,
  bookEntries,
} from './domain';
import { Dialog, Empty, Icon, Label, categoryIcons } from './ui';
import {
  encryptBackup,
  decryptBackup,
  exportCsv,
  restoreBackup,
  MAX_BACKUP_SIZE,
  type BackupPreview,
} from './backup';
import { clearExportCache, saveFile } from './files';
import { orderedCategories, moveCategory } from './experience';
import { expensePresets } from './categoryPresets';

export function Welcome() {
  const { run } = useLedger();
  const [name, setName] = useState('日常账本'),
    [currency, setCurrency] = useState<Currency>('CNY'),
    [busy, setBusy] = useState(false);
  return (
    <main className="welcome">
      <div className="welcome-copy">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="wallet" size={24} />
          </span>
          <b>口袋账本</b>
        </div>
        <span className="eyebrow">一点记录，一点从容</span>
        <h1>
          每一种生活，
          <br />
          都记得清楚。
        </h1>
        <p>
          一杯咖啡，一次旅行。
          <br />
          让每一笔花费，都有自己的位置。
        </p>
        <div className="welcome-badges">
          <span>
            <Icon name="shield" size={16} />
            数据留在本机
          </span>
          <span>
            <Icon name="coins" size={16} />
            多币种独立统计
          </span>
        </div>
      </div>
      <form
        className="welcome-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await run((s) => {
            createBook(s, name, currency);
          });
          setBusy(false);
        }}
      >
        <div className="welcome-illustration">
          <Icon name="book" size={66} />
          <span>✦</span>
        </div>
        <h2>从第一本账开始</h2>
        <p>{isNative ? '不用注册，也不用联网。' : '不用注册，首次加载完成后可离线记账。'}</p>
        <Label title="账本名称">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            required
            aria-label="账本名称"
          />
        </Label>
        <Label title="默认币种">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            aria-label="默认币种"
          >
            {currencyCodes.map((c) => (
              <option key={c} value={c}>
                {CURRENCIES[c].name} · {c}
              </option>
            ))}
          </select>
        </Label>
        <button className="primary wide" disabled={busy}>
          {busy ? '创建中…' : '开启我的账本'}
          <Icon name="arrow" size={18} />
        </button>
        <small className="privacy-note">
          数据仅存于这台设备。请定期导出加密备份，换机时手动恢复。
        </small>
      </form>
      <PwaPanel compact />
    </main>
  );
}
export function BooksDialog({ onClose }: { onClose: () => void }) {
  const { state, run, confirm } = useLedger();
  const [editing, setEditing] = useState<Book | null>(null),
    [newBook, setNewBook] = useState(false);
  const [name, setName] = useState(''),
    [currency, setCurrency] = useState<Currency>('CNY'),
    [timezone, setTimezone] = useState('Asia/Shanghai');
  const [common, setCommon] = useState<Currency[]>(['CNY', 'HKD']),
    [search, setSearch] = useState(''),
    [deleteName, setDeleteName] = useState('');
  const start = (book?: Book) => {
    setEditing(book ?? null);
    setNewBook(!book);
    setName(book?.name ?? '');
    setCurrency(book?.currency ?? 'CNY');
    setTimezone(book?.timezone ?? 'Asia/Shanghai');
    setCommon(book?.common ?? ['CNY', 'HKD']);
    setSearch('');
    setDeleteName('');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      await run(
        (s) => {
          if (editing) {
            const b = s.books.find((b) => b.id === editing.id)!;
            if (b.archived || b.deletedAt) throw new Error('请先解除归档或恢复账本');
            if (s.books.some((x) => x.id !== b.id && !x.deletedAt && x.name === name.trim()))
              throw new Error('已有同名账本');
            b.name = name.trim();
            b.currency = currency;
            b.common = Array.from(new Set([currency, ...common]));
            touch(s, b.id);
          } else createBook(s, name, currency, timezone);
        },
        editing ? '账本设置已保存' : '新账本已创建',
      )
    ) {
      setEditing(null);
      setNewBook(false);
    }
  };
  return (
    <Dialog title={editing ? '账本设置' : newBook ? '新建账本' : '我的账本'} onClose={onClose}>
      {editing || newBook ? (
        <form onSubmit={submit}>
          <Label title="账本名称">
            <input
              aria-label="账本名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              required
            />
          </Label>
          <Label title="默认币种" hint="只影响新记录的预填币种，不改变历史金额。">
            <select
              aria-label="默认币种"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {currencyCodes.map((c) => (
                <option value={c} key={c}>
                  {CURRENCIES[c].name} · {c}
                </option>
              ))}
            </select>
          </Label>
          <Label title="账本时区" hint="创建后固定，旅行时旧记录的日期不会漂移。">
            <select
              value={timezone}
              disabled={!!editing}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {[
                'Asia/Shanghai',
                'Asia/Hong_Kong',
                'Asia/Tokyo',
                'Asia/Singapore',
                'Europe/London',
                'America/New_York',
                'America/Los_Angeles',
                'UTC',
              ].map((z) => (
                <option value={z} key={z}>
                  {z}
                </option>
              ))}
            </select>
          </Label>
          {editing && (
            <div className="field">
              <span>常用币种</span>
              <input
                placeholder="搜索人民币、RMB、HKD…"
                aria-label="搜索币种"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="currency-checks">
                {currencyCodes
                  .filter((c) =>
                    `${c} ${CURRENCIES[c].name} ${CURRENCIES[c].alias}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((c) => (
                    <label key={c}>
                      <input
                        type="checkbox"
                        checked={common.includes(c) || c === currency}
                        disabled={c === currency}
                        onChange={(e) =>
                          setCommon(
                            e.target.checked ? [...common, c] : common.filter((x) => x !== c),
                          )
                        }
                      />
                      <b>{c}</b>
                      {CURRENCIES[c].name}
                    </label>
                  ))}
              </div>
            </div>
          )}
          <div className="actions">
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setEditing(null);
                setNewBook(false);
              }}
            >
              返回
            </button>
            <button className="primary" disabled={editing?.archived}>
              保存账本
            </button>
          </div>
          {editing && (
            <div className="danger-zone">
              <button
                type="button"
                className="text-button"
                onClick={async () => {
                  if (
                    await run(
                      (s) => {
                        const b = s.books.find((b) => b.id === editing.id)!;
                        b.archived = !b.archived;
                        touch(s, b.id);
                      },
                      editing.archived ? '已解除归档' : '已归档，账本只读',
                    )
                  )
                    setEditing(null);
                }}
              >
                <Icon name="archive" size={18} />
                {editing.archived ? '解除归档' : '归档这个账本'}
              </button>
              <Label title="删除账本" hint="输入账本名称确认，7 天内可以撤销。">
                <input
                  placeholder={editing.name}
                  value={deleteName}
                  onChange={(e) => setDeleteName(e.target.value)}
                />
              </Label>
              <button
                type="button"
                className="danger"
                disabled={deleteName !== editing.name}
                onClick={async () => {
                  if (
                    await confirm(
                      '删除这个账本？',
                      '账本及其中所有记录将进入 7 天撤销期。建议先导出备份。',
                      true,
                      '删除账本',
                    )
                  ) {
                    if (
                      await run((s) => {
                        const b = s.books.find((b) => b.id === editing.id)!;
                        b.deletedAt = Date.now();
                        s.activeBookId = s.books.find((x) => !x.deletedAt)?.id ?? null;
                      }, '账本已删除，7 天内可撤销')
                    )
                      setEditing(null);
                  }
                }}
              >
                删除账本
              </button>
            </div>
          )}
        </form>
      ) : (
        <>
          <p className="dialog-copy">账本都保存在这台设备中，不会与他人共享。</p>
          <div className="book-list">
            {state.books
              .filter((b) => !b.deletedAt)
              .map((b) => (
                <div
                  className={`book-row ${state.activeBookId === b.id ? 'selected' : ''}`}
                  key={b.id}
                >
                  <button
                    className="book-main"
                    onClick={async () => {
                      if (
                        await run((s) => {
                          s.activeBookId = b.id;
                        })
                      )
                        onClose();
                    }}
                  >
                    <span className="category-icon">
                      <Icon name={b.archived ? 'archive' : 'book'} />
                    </span>
                    <span>
                      <b>{b.name}</b>
                      <small>
                        {b.currency} 默认 ·{' '}
                        {b.archived ? '已归档' : `${bookEntries(state, b.id).length} 笔记录`}
                      </small>
                    </span>
                    {state.activeBookId === b.id && <Icon name="check" size={18} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`设置${b.name}`}
                    onClick={() => start(b)}
                  >
                    <Icon name="edit" size={18} />
                  </button>
                </div>
              ))}
          </div>
          <button className="secondary wide" onClick={() => start()}>
            <Icon name="plus" size={18} />
            新建账本
          </button>
          {state.books.some((b) => b.deletedAt) && (
            <div className="section-sub">
              <h3>已删除账本</h3>
              {state.books
                .filter((b) => b.deletedAt)
                .map((b) => (
                  <div className="simple-row" key={b.id}>
                    <span>
                      {b.name}
                      <small>
                        剩余约 {Math.max(0, Math.ceil(7 - (Date.now() - b.deletedAt!) / 86400000))}{' '}
                        天
                      </small>
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        run((s) => {
                          const x = s.books.find((x) => x.id === b.id)!;
                          delete x.deletedAt;
                          s.activeBookId = x.id;
                        }, '已撤销删除')
                      }
                    >
                      撤销删除
                    </button>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
export function BudgetEditor({
  book,
  currency,
  month,
  onClose,
}: {
  book: Book;
  currency: Currency;
  month: string;
  onClose: () => void;
}) {
  const { state, run } = useLedger();
  const existing = state.budgets.find(
    (b) => b.bookId === book.id && b.currency === currency && b.month === month,
  );
  const [total, setTotal] = useState(existing ? amountText(existing.amount, currency) : '');
  const [categoryAmounts, setCategoryAmounts] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(existing?.categories ?? {}).map(([id, n]) => [id, amountText(n, currency)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`${month} · ${currency} 预算`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          if (
            await run((s) => {
              const budget: Budget = {
                bookId: book.id,
                month,
                currency,
                amount: parseMoney(total, currency),
                categories: Object.fromEntries(
                  Object.entries(categoryAmounts)
                    .filter(([, value]) => value.trim())
                    .map(([id, value]) => [id, parseMoney(value, currency)]),
                ),
              };
              saveBudget(s, budget);
            }, '预算已保存')
          )
            onClose();
          setBusy(false);
        }}
      >
        <p className="dialog-copy">
          {CURRENCIES[currency].name}消费只使用这份预算，其他币种互不影响。
        </p>
        <Label title="本月总预算">
          <input
            aria-label="本月总预算"
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="0.00"
            required
          />
        </Label>
        <h3>
          分类预算 <span className="subtle">选填</span>
        </h3>
        <p className="inline-note">分类额度之和不能超过总预算，留空表示不单独限制。</p>
        <div className="budget-fields">
          {state.categories
            .filter(
              (c) =>
                c.bookId === book.id &&
                c.type === 'expense' &&
                (c.active || existing?.categories[c.id]),
            )
            .map((c) => (
              <label className="category-budget" key={c.id}>
                <span>
                  <Icon name={c.icon} size={18} />
                  {c.name}
                </span>
                <input
                  aria-label={`${c.name}预算`}
                  inputMode="decimal"
                  placeholder="未设置"
                  value={categoryAmounts[c.id] ?? ''}
                  onChange={(e) =>
                    setCategoryAmounts({ ...categoryAmounts, [c.id]: e.target.value })
                  }
                />
              </label>
            ))}
        </div>
        <button className="primary wide" disabled={busy}>
          {busy ? '保存中…' : '保存预算'}
        </button>
      </form>
    </Dialog>
  );
}
export function EntryDetail({
  entry,
  onClose,
  onEdit,
  onRefund,
  onRepeat,
}: {
  entry: Entry;
  onClose: () => void;
  onEdit: () => void;
  onRefund: () => void;
  onRepeat: () => void;
}) {
  const { state, run, confirm } = useLedger();
  const cat = state.categories.find((c) => c.id === entry.categoryId),
    book = state.books.find((b) => b.id === entry.bookId)!;
  const readonly = book.archived || !!book.deletedAt;
  return (
    <Dialog title="记录详情" onClose={onClose}>
      <div className="detail-hero">
        <span className={`category-icon ${entry.type}`}>
          <Icon name={entry.type === 'refund' ? 'refund' : (cat?.icon ?? 'dots')} size={26} />
        </span>
        <p>
          {cat?.name} · {{ income: '收入', expense: '支出', refund: '退款' }[entry.type]}
        </p>
        <h2>{money(entry.amount, entry.currency)}</h2>
      </div>
      <dl className="detail-list">
        <div>
          <dt>账本</dt>
          <dd>{book.name}</dd>
        </div>
        <div>
          <dt>发生时间</dt>
          <dd>{entry.occurredAt.replace('T', ' ')}</dd>
        </div>
        <div>
          <dt>支付方式</dt>
          <dd>{state.payments.find((p) => p.id === entry.paymentId)?.name ?? '未填写'}</dd>
        </div>
        <div>
          <dt>备注</dt>
          <dd>{entry.note || '未填写'}</dd>
        </div>
        <div>
          <dt>保存位置</dt>
          <dd>这台设备</dd>
        </div>
        {entry.type === 'expense' && (
          <>
            <div>
              <dt>已退款</dt>
              <dd>{money(entry.amount - remainingRefund(state, entry), entry.currency)}</dd>
            </div>
            <div>
              <dt>尚未退款</dt>
              <dd>{money(remainingRefund(state, entry), entry.currency)}</dd>
            </div>
          </>
        )}
      </dl>
      <div className="actions">
        {entry.type !== 'refund' && (
          <button className="secondary" onClick={onRepeat} disabled={readonly}>
            <Icon name="plus" size={16} />
            再记一笔
          </button>
        )}
        <button className="secondary" onClick={onEdit} disabled={readonly}>
          <Icon name="edit" size={16} />
          编辑
        </button>
        {entry.type === 'expense' && (
          <button
            className="secondary"
            onClick={onRefund}
            disabled={readonly || remainingRefund(state, entry) === 0}
          >
            <Icon name="refund" size={16} />
            退款
          </button>
        )}
        <button
          className="danger"
          disabled={readonly}
          onClick={async () => {
            if (
              await confirm(
                '删除这笔记录？',
                entry.type === 'expense' && remainingRefund(state, entry) < entry.amount
                  ? '原支出及其有效退款将一起进入回收站，30 天内可以恢复。'
                  : '记录将进入回收站，30 天内可以恢复。',
                true,
                '删除记录',
              )
            ) {
              if (await run((s) => deleteEntry(s, entry.id), '已移入回收站')) onClose();
            }
          }}
        >
          <Icon name="trash" size={16} />
          删除
        </button>
      </div>
    </Dialog>
  );
}
export function TrashDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const { state, run } = useLedger();
  const entries = state.entries.filter(
    (e) => e.bookId === book.id && e.deletedAt && (!e.deletionGroup || e.deletionGroup === e.id),
  );
  return (
    <Dialog title="回收站" onClose={onClose}>
      <p className="dialog-copy">记录保留 30 天。成组删除的支出与退款将一起恢复。</p>
      {entries.length ? (
        entries.map((e) => (
          <div className="simple-row" key={e.id}>
            <span>
              <b>
                {state.categories.find((c) => c.id === e.categoryId)?.name} ·{' '}
                {money(e.amount, e.currency)}
              </b>
              <small>
                {e.occurredAt.slice(0, 10)} · 剩余{' '}
                {Math.max(0, Math.ceil(30 - (Date.now() - e.deletedAt!) / 86400000))} 天
              </small>
            </span>
            <button
              className="text-button"
              onClick={() => run((s) => restoreEntry(s, e.id), '记录已恢复')}
            >
              恢复
            </button>
          </div>
        ))
      ) : (
        <Empty title="没有已删除记录" detail="删除的记录会暂时留在这里。" icon="trash" />
      )}
    </Dialog>
  );
}
export function CategoriesDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const { state, run } = useLedger();
  const [type, setType] = useState<'expense' | 'income' | 'payment'>('expense'),
    [name, setName] = useState(''),
    [editId, setEditId] = useState(''),
    [icon, setIcon] = useState('dots'),
    [editing, setEditing] = useState(false),
    [dragId, setDragId] = useState('');
  const isPinned = (item: { id: string }) =>
    !!state.categories.find((c) => c.id === item.id)?.pinned;
  const items =
    type === 'payment'
      ? state.payments.filter((p) => p.bookId === book.id)
      : orderedCategories(state.categories.filter((c) => c.bookId === book.id && c.type === type));
  return (
    <Dialog title="分类与支付方式" onClose={editing ? () => setEditing(false) : onClose}>
      <div className="segmented">
        {(['expense', 'income', 'payment'] as const).map((t) => (
          <button
            key={t}
            className={type === t ? 'active' : ''}
            onClick={() => {
              setType(t);
              setName('');
              setEditId('');
              setIcon('dots');
              setEditing(false);
            }}
          >
            {t === 'expense' ? '支出分类' : t === 'income' ? '收入分类' : '支付方式'}
          </button>
        ))}
      </div>
      {!editing && (
        <button
          className="secondary wide"
          disabled={book.archived}
          onClick={() => {
            setName('');
            setEditId('');
            setIcon('dots');
            setEditing(true);
          }}
        >
          <Icon name="plus" size={18} />
          {type === 'payment' ? '新增支付方式' : '新增分类'}
        </button>
      )}
      {!editing && type !== 'payment' && (
        <p className="dialog-copy category-order-hint">
          置顶常用分类；用箭头调整同组顺序，电脑上也可以拖动。
        </p>
      )}
      {editing ? (
        <form
          className="category-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(
                (s) => {
                  writableBook(s, book.id);
                  const list =
                    type === 'payment'
                      ? s.payments.filter((p) => p.bookId === book.id)
                      : s.categories.filter((c) => c.bookId === book.id && c.type === type);
                  const value = name.trim();
                  if (!value || value.length > 20) throw new Error('名称需要 1 至 20 个字符');
                  if (list.some((x) => x.name === value && x.id !== editId))
                    throw new Error('已有同名项目');
                  if (editId) {
                    const target = list.find((x) => x.id === editId)!;
                    target.name = value;
                    if ('icon' in target) target.icon = icon;
                  } else if (type === 'payment')
                    s.payments.push({ id: uid(), bookId: book.id, name: value, active: true });
                  else
                    s.categories.push({
                      id: uid(),
                      bookId: book.id,
                      name: value,
                      type,
                      icon,
                      active: true,
                    });
                  touch(s, book.id);
                },
                editId ? '已保存，历史记录同步显示新的名称和图标' : '已添加',
              )
            ) {
              setName('');
              setEditId('');
              setIcon('dots');
              setEditing(false);
            }
          }}
        >
          {!editId && type === 'expense' && (
            <details className="category-presets">
              <summary>从推荐分类中选择</summary>
              <p className="dialog-copy">选择后自动填写名称和图标，还可以修改，点击“添加”保存。</p>
              <div className="preset-grid">
                {expensePresets.map((preset) => {
                  const existing = items.find((item) => item.name === preset.name);
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      title={preset.detail}
                      aria-label={`选择推荐分类${preset.name}`}
                      disabled={book.archived || !!existing}
                      onClick={() => {
                        setName(preset.name);
                        setIcon(preset.icon);
                      }}
                    >
                      <Icon name={preset.icon} />
                      <span>{preset.name}</span>
                      {existing && <small>{existing.active ? '已有' : '已停用'}</small>}
                    </button>
                  );
                })}
              </div>
            </details>
          )}
          <div className="inline-form">
            <input
              aria-label="分类名称"
              placeholder={editId ? '修改名称' : '添加新的名称'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
            />
            <button className="primary" disabled={book.archived}>
              {editId ? '保存' : '添加'}
            </button>
            {
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setName('');
                  setEditId('');
                  setIcon('dots');
                  setEditing(false);
                }}
              >
                取消
              </button>
            }
          </div>
          {type !== 'payment' && (
            <fieldset className="category-icon-picker" disabled={book.archived}>
              <legend>分类图标</legend>
              <div className="category-icon-grid">
                {categoryIcons.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={`${label}图标`}
                    aria-pressed={icon === key}
                    onClick={() => setIcon(key)}
                  >
                    <Icon name={key} size={22} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </form>
      ) : (
        <div className="management-list category-management">
          {items.map((item, index) => (
            <div
              className="simple-row"
              key={item.id}
              draggable={type !== 'payment' && !book.archived}
              onDragStart={(e) => {
                setDragId(item.id);
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragId('')}
              onDragOver={(e) => {
                if (dragId && type !== 'payment' && !book.archived) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && !book.archived) void run((s) => moveCategory(s, dragId, item.id));
                setDragId('');
              }}
            >
              <span className="managed-category">
                {'icon' in item && typeof item.icon === 'string' && (
                  <span className="category-icon" data-icon={item.icon}>
                    <Icon name={item.icon} />
                  </span>
                )}
                <span>
                  {item.name}
                  {'pinned' in item && item.pinned === true && <small>常用</small>}
                  {!item.active && <small>已停用 · 历史记录保留</small>}
                </span>
              </span>
              <div className="row-actions">
                {type !== 'payment' && (
                  <>
                    <button
                      className="icon-button"
                      disabled={book.archived}
                      aria-label={`${'pinned' in item && item.pinned ? '取消置顶' : '置顶'}${item.name}`}
                      aria-pressed={'pinned' in item && item.pinned === true}
                      onClick={() =>
                        run((s) => {
                          writableBook(s, book.id);
                          const c = s.categories.find((c) => c.id === item.id)!;
                          c.pinned = !c.pinned;
                          touch(s, book.id);
                        })
                      }
                    >
                      <Icon name="pin" size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`上移${item.name}`}
                      disabled={
                        book.archived ||
                        index === 0 ||
                        isPinned(item) !== isPinned(items[index - 1])
                      }
                      onClick={() => run((s) => moveCategory(s, item.id, items[index - 1].id))}
                    >
                      <Icon name="up" size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`下移${item.name}`}
                      disabled={
                        book.archived ||
                        index === items.length - 1 ||
                        isPinned(item) !== isPinned(items[index + 1])
                      }
                      onClick={() => run((s) => moveCategory(s, item.id, items[index + 1].id))}
                    >
                      <Icon name="down" size={17} />
                    </button>
                  </>
                )}
                <button
                  className="icon-button"
                  aria-label={`编辑${item.name}`}
                  onClick={() => {
                    setEditId(item.id);
                    setName(item.name);
                    setIcon('icon' in item && typeof item.icon === 'string' ? item.icon : 'dots');
                    setEditing(true);
                  }}
                  disabled={book.archived}
                >
                  <Icon name="edit" size={17} />
                </button>
                <button
                  className="text-button"
                  disabled={book.archived}
                  onClick={() =>
                    run((s) => {
                      writableBook(s, book.id);
                      const target = (type === 'payment' ? s.payments : s.categories).find(
                        (x) => x.id === item.id,
                      )!;
                      target.active = !target.active;
                      touch(s, book.id);
                    })
                  }
                >
                  {item.active ? '停用' : '启用'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
export function BackupDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const { state, run, notify, confirm } = useLedger();
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [tab, setTab] = useState<'backup' | 'restore' | 'csv' | 'protection'>('backup'),
    [scope, setScope] = useState('all');
  const [password, setPassword] = useState(''),
    [again, setAgain] = useState(''),
    [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null),
    [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(localTime(book.timezone).slice(0, 7) + '-01'),
    [to, setTo] = useState(localTime(book.timezone).slice(0, 10)),
    [currency, setCurrency] = useState<Currency | 'all'>('all');
  const lock = useRef(false);
  const task = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="导出与备份"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="segmented backup-tabs">
        {(['backup', 'restore', 'csv', 'protection'] as const).map((t) => (
          <button
            disabled={busy}
            key={t}
            className={t === tab ? 'active' : ''}
            onClick={() => {
              setPrepared(null);
              setTab(t);
              setPassword('');
              setAgain('');
              setPreview(null);
            }}
          >
            {t === 'backup'
              ? '加密备份'
              : t === 'restore'
                ? '恢复备份'
                : t === 'csv'
                  ? '导出 CSV'
                  : '本机保护'}
          </button>
        ))}
      </div>
      {prepared && <WebExport value={prepared} />}
      {tab === 'protection' && <ProtectionPanel />}
      {tab === 'backup' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void task(async () => {
              if (password !== again) throw new Error('两次密码不一致');
              const ids =
                scope === 'all'
                  ? state.books.filter((b) => !b.deletedAt).map((b) => b.id)
                  : [book.id];
              const snapshotAt = Date.now();
              const text = await encryptBackup(state, ids, password);
              const name = `口袋账本-${localTime().slice(0, 10)}.pocket`;
              if (!isNative) setPrepared({ name, text, mime: 'application/json' });
              const result = await saveFile(name, text, 'application/json');
              await run((s) => {
                for (const id of ids) s.backups[id] = snapshotAt;
              });
              notify(result);
              setPassword('');
              setAgain('');
            });
          }}
        >
          <div className="notice">
            <Icon name="lock" />
            密码加密，独立保存。换机也能恢复。
          </div>
          <Label title="备份范围">
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">全部账本（含已归档）</option>
              <option value="current">仅 {book.name}</option>
            </select>
          </Label>
          <Label title="备份密码" hint="至少 8 个字符。密码无法找回，请妥善保存。">
            <input
              aria-label="备份密码"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={200}
              required
            />
          </Label>
          <Label title="确认密码">
            <input
              aria-label="确认密码"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              minLength={8}
              maxLength={200}
              required
            />
          </Label>
          <p className="inline-note">
            包含有效记录、币种、分类、预算、常用模板和退款关联。不含草稿、回收站。请保存到手机外的位置。
          </p>
          <button className="primary wide" disabled={busy}>
            <Icon name="download" size={18} />
            {busy ? '正在生成…' : '生成加密备份'}
          </button>
        </form>
      )}
      {tab === 'restore' && (
        <div>
          <p className="dialog-copy">
            恢复为新的本地账本，现有记录不会被覆盖。两台设备不会自动同步。
          </p>
          <Label title="选择备份文件">
            <input
              aria-label="选择备份文件"
              type="file"
              accept={
                isNative ? '.pocket,.json,application/json,application/octet-stream' : undefined
              }
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
          </Label>
          <Label title="备份密码">
            <input
              aria-label="恢复密码"
              type="password"
              value={password}
              disabled={busy}
              onChange={(e) => {
                setPassword(e.target.value);
                setPreview(null);
              }}
            />
          </Label>
          <button
            className="secondary wide"
            disabled={busy || !file || !password}
            onClick={() =>
              task(async () => {
                if (!file) return;
                if (file.size > MAX_BACKUP_SIZE) throw new Error('文件超过 25 MB');
                setPreview(await decryptBackup(await file.text(), password));
              })
            }
          >
            {busy ? '正在校验…' : '校验并预览'}
          </button>
          {preview && (
            <div className="backup-preview">
              <h3>备份校验通过</h3>
              <p>
                {new Date(preview.createdAt).toLocaleString('zh-CN')} ·{' '}
                {preview.state.entries.length} 笔记录 · {preview.state.templates.length} 个模板
              </p>
              {preview.state.books.map((b) => (
                <div key={b.id} className="preview-book">
                  <b>{b.name}</b>
                  {currencyCodes
                    .filter((c) =>
                      preview.state.entries.some((e) => e.bookId === b.id && e.currency === c),
                    )
                    .map((c) => (
                      <div key={c} className="simple-row">
                        <span>{c} 净支出</span>
                        <b>{money(summarize(bookEntries(preview.state, b.id), c).net, c)}</b>
                      </div>
                    ))}
                </div>
              ))}
              <button
                className="primary wide"
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    let duplicate = false;
                    if (state.restored.includes(preview.fingerprint)) {
                      duplicate = await confirm(
                        '这份备份已恢复过',
                        '再次恢复会新建独立副本，记录不会自动去重或合并。',
                        false,
                        '另建副本',
                      );
                      if (!duplicate) return;
                    }
                    if (
                      await run(
                        (s) => restoreBackup(s, preview, duplicate),
                        '恢复完成，已创建新账本',
                      )
                    )
                      onClose();
                  })
                }
              >
                确认恢复为新账本
              </button>
            </div>
          )}
        </div>
      )}
      {tab === 'csv' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void task(async () => {
              if (!from || !to || from > to) throw new Error('请选择有效日期范围');
              const entries = bookEntries(state, book.id).filter(
                (e) =>
                  e.occurredAt.slice(0, 10) >= from &&
                  e.occurredAt.slice(0, 10) <= to &&
                  (currency === 'all' || e.currency === currency),
              );
              if (!entries.length) throw new Error('这个范围没有可导出的记录');
              const name = `口袋账本-${from}-${to}.csv`;
              const text = exportCsv(state, entries),
                mime = 'text/csv;charset=utf-8';
              if (!isNative) setPrepared({ name, text, mime });
              notify(await saveFile(name, text, mime));
            });
          }}
        >
          <div className="notice">CSV 为明文分析文件，不能用于恢复 App。</div>
          <div className="form-grid">
            <Label title="开始日期">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </Label>
            <Label title="结束日期">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
            </Label>
          </div>
          <Label title="币种">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency | 'all')}
            >
              <option value="all">全部币种，分别保留币种列</option>
              {currencyCodes.map((c) => (
                <option key={c} value={c}>
                  {c} · {CURRENCIES[c].name}
                </option>
              ))}
            </select>
          </Label>
          <p className="inline-note">
            范围：{book.name}。如退款原支出不在日期范围内，仅保留原支出标识。
          </p>
          <button className="primary wide" disabled={busy}>
            导出明细 CSV
          </button>
        </form>
      )}
    </Dialog>
  );
}
export function ClearDialog({ onClose }: { onClose: () => void }) {
  const { clear, notify } = useLedger();
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="清空全部本地数据" onClose={onClose} compact>
      <p className="dialog-copy">
        所有账本、记录、模板、草稿、回收站及本机保护副本都将被删除，无法撤销。请先导出备份。另存的
        CSV 和备份文件需要自行管理。
      </p>
      <Label title="输入“清空全部数据”确认">
        <input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </Label>
      <button
        className="danger wide"
        disabled={text !== '清空全部数据' || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await clearExportCache();
            await clear();
            onClose();
            notify('本机数据已清空');
          } catch {
            notify('清除未完成，请重试');
          }
          setBusy(false);
        }}
      >
        永久清空
      </button>
    </Dialog>
  );
}
