import { PwaPanel } from './PwaPanel';
import { SyncPanel, SyncStatusButton } from './SyncPanel';
import { ComparisonPanel } from './ComparisonPanel';
import { TemplatesDialog } from './TemplatesDialog';
import { useEffect, useMemo, useState } from 'react';
import { useLedger } from './context';
import { type Entry, type EntryTemplate, localTime } from './model';
import { bookEntries, summarize, inheritBudgets } from './domain';
import { CURRENCIES, currencyCodes, money, type Currency } from './money';
import { Icon, Empty } from './ui';
import { isNative } from './storage';
import { EntryEditor } from './EntryEditor';
import { MonthPicker } from './MonthPicker';
import { backupDue } from './experience';
import { bookOverview } from './bookOverview';
import {
  Welcome,
  BooksDialog,
  BudgetEditor,
  EntryDetail,
  TrashDialog,
  CategoriesDialog,
  BackupDialog,
  ClearDialog,
} from './panels';

type Page = 'records' | 'stats' | 'budget' | 'settings';
type Panel = 'templates' | 'books' | 'budget' | 'trash' | 'categories' | 'backup' | 'clear' | null;
const navigation = [
  { id: 'records', label: '明细', icon: 'book' },
  { id: 'stats', label: '统计', icon: 'stats' },
  { id: 'budget', label: '预算', icon: 'target' },
  { id: 'settings', label: '设置', icon: 'settings' },
] as const;
const categoryColors = ['peach', 'green', 'blue', 'purple', 'yellow'];

export default function App() {
  const { state, run } = useLedger();
  const book =
    state.books.find((b) => b.id === state.activeBookId && !b.deletedAt) ??
    state.books.find((b) => !b.deletedAt);
  const [page, setPage] = useState<Page>('records'),
    [panel, setPanel] = useState<Panel>(null);
  const [browseSyncedBooks, setBrowseSyncedBooks] = useState(false);
  const [requestedView, setRequestedView] = useState<{ bookId: string; month: string } | null>(
    null,
  );
  const overview = useMemo(() => bookOverview(state), [state]);
  const otherRecordCount = overview
    .filter((row) => row.book.id !== book?.id)
    .reduce((sum, row) => sum + row.count, 0);
  const openSyncedBooks = () => {
    setBrowseSyncedBooks(true);
    setPanel('books');
  };
  const [month, setMonth] = useState(localTime().slice(0, 7)),
    [currency, setCurrency] = useState<Currency | 'all'>('all'),
    [statsCurrency, setStatsCurrency] = useState<Currency>('CNY');
  const [query, setQuery] = useState(''),
    [filterOpen, setFilterOpen] = useState(false),
    [categoryFilter, setCategoryFilter] = useState(''),
    [paymentFilter, setPaymentFilter] = useState(''),
    [typeFilter, setTypeFilter] = useState('');
  const [period, setPeriod] = useState<'month' | 'year' | 'custom'>('month'),
    [from, setFrom] = useState(month + '-01'),
    [to, setTo] = useState(localTime().slice(0, 10));
  const [editor, setEditor] = useState<{
      entry?: Entry;
      refund?: Entry;
      repeat?: Entry;
      template?: EntryTemplate;
    } | null>(null),
    [detailId, setDetailId] = useState<string | null>(null);
  const [statsType, setStatsType] = useState<'expense' | 'income'>('expense'),
    [limit, setLimit] = useState(30);
  useEffect(() => {
    if (book) {
      setStatsCurrency(book.currency);
      setCurrency('all');
      setCategoryFilter('');
      setPaymentFilter('');
      setQuery('');
      setTypeFilter('');
      setPeriod('month');
      setMonth(localTime(book.timezone).slice(0, 7));
      void run((s) => inheritBudgets(s, book.id, localTime(book.timezone).slice(0, 7)));
    }
  }, [book?.id]);
  useEffect(() => {
    if (!requestedView || requestedView.bookId !== book?.id) return;
    setPage('records');
    setMonth(requestedView.month);
    setPeriod('month');
    setCurrency('all');
    setQuery('');
    setCategoryFilter('');
    setPaymentFilter('');
    setTypeFilter('');
    setFilterOpen(false);
    setRequestedView(null);
  }, [book?.id, requestedView]);
  useEffect(() => {
    setLimit(30);
  }, [month, currency, query, categoryFilter, paymentFilter, typeFilter, period, from, to]);
  useEffect(() => {
    const back = (e: Event) => {
      if (document.querySelector('[role="dialog"]') || page === 'records') return;
      e.preventDefault();
      setPage('records');
    };
    document.addEventListener('ledger-back', back);
    return () => document.removeEventListener('ledger-back', back);
  }, [page]);
  const all = useMemo(() => (book ? bookEntries(state, book.id) : []), [state, book?.id]);
  const periodEntries = useMemo(
    () =>
      all.filter((e) =>
        period === 'year'
          ? e.occurredAt.startsWith(month.slice(0, 4))
          : period === 'custom'
            ? e.occurredAt.slice(0, 10) >= from && e.occurredAt.slice(0, 10) <= to
            : e.occurredAt.startsWith(month),
      ),
    [all, period, month, from, to],
  );
  const filteredWithoutCurrency = useMemo(
    () =>
      periodEntries.filter(
        (e) =>
          (!query || e.note.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
          (!categoryFilter || e.categoryId === categoryFilter) &&
          (!paymentFilter ||
            (paymentFilter === 'none' ? !e.paymentId : e.paymentId === paymentFilter)) &&
          (!typeFilter || e.type === typeFilter),
      ),
    [periodEntries, query, categoryFilter, paymentFilter, typeFilter],
  );
  const filtered = useMemo(
    () =>
      filteredWithoutCurrency
        .filter((e) => currency === 'all' || e.currency === currency)
        .sort(
          (a, b) =>
            b.occurredAt.localeCompare(a.occurredAt) ||
            b.createdAt - a.createdAt ||
            b.id.localeCompare(a.id),
        ),
    [filteredWithoutCurrency, currency],
  );
  if (!book)
    return (
      <>
        <Welcome />
        {state.books.some((b) => b.deletedAt) && (
          <button className="recover-books" onClick={() => setPanel('books')}>
            找回已删除账本
          </button>
        )}
        {panel === 'books' && <BooksDialog onClose={() => setPanel(null)} />}
      </>
    );
  const readonly = book.archived;
  const summaryCurrencies =
    currency === 'all'
      ? currencyCodes.filter((c) => filteredWithoutCurrency.some((e) => e.currency === c))
      : [currency];
  const displayedCurrencies = summaryCurrencies.length
    ? summaryCurrencies
    : book.common.slice(0, 2);
  const summary = summarize(periodEntries, statsCurrency);
  const monthRows = all.filter((e) => e.occurredAt.startsWith(month));
  const budgetSummary = summarize(monthRows, statsCurrency);
  const budget = state.budgets.find(
    (b) => b.bookId === book.id && b.month === month && b.currency === statsCurrency,
  );
  const used = Math.max(0, budgetSummary.net),
    ratio = budget ? used / budget.amount : 0;
  const statsRows = periodEntries.filter((e) => e.currency === statsCurrency);
  const ranked = state.categories
    .filter((c) => c.bookId === book.id && c.type === statsType)
    .map((c) => ({
      ...c,
      value:
        statsType === 'income'
          ? statsRows
              .filter((e) => e.categoryId === c.id && e.type === 'income')
              .reduce((a, e) => a + e.amount, 0)
          : summarize(
              statsRows.filter((e) => e.categoryId === c.id),
              statsCurrency,
            ).net,
      count: statsRows.filter((e) => e.categoryId === c.id).length,
    }))
    .filter((c) => c.count)
    .sort((a, b) => b.value - a.value);
  const maxCategory = Math.max(1, ...ranked.map((c) => Math.abs(c.value)));
  const groups = new Map<string, Entry[]>();
  for (const e of filtered.slice(0, limit)) {
    const key = e.occurredAt.slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const chartGroups = new Map<string, number>();
  for (const e of statsRows) {
    const key = e.occurredAt.slice(0, period === 'year' ? 7 : 10);
    const value =
      statsType === 'income'
        ? e.type === 'income'
          ? e.amount
          : 0
        : e.type === 'expense'
          ? e.amount
          : e.type === 'refund'
            ? -e.amount
            : 0;
    chartGroups.set(key, (chartGroups.get(key) ?? 0) + value);
  }
  const trend = [...chartGroups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const maxTrend = Math.max(1, ...trend.map(([, n]) => Math.abs(n)));
  const detail = state.entries.find((e) => e.id === detailId && !e.deletedAt);
  const viewTitle = {
    records: '让每一笔，都有迹可循。',
    stats: '看见开销，也看见生活。',
    budget: '给想要的生活，留点余地。',
    settings: '你的账本，由你保管。',
  }[page];
  const clearFilters = () => {
    setQuery('');
    setCategoryFilter('');
    setPaymentFilter('');
    setTypeFilter('');
    setCurrency('all');
    setPeriod('month');
  };
  const periodControls = (
    <>
      <div className="period-toggle">
        <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>
          月度
        </button>
        <button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>
          年度
        </button>
        <button className={period === 'custom' ? 'active' : ''} onClick={() => setPeriod('custom')}>
          自定义
        </button>
      </div>
      {period === 'custom' && (
        <div className="date-range">
          <input
            aria-label="筛选开始日期"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span>至</span>
          <input
            aria-label="筛选结束日期"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {from > to && <small className="error-text">开始日期不能晚于结束日期</small>}
        </div>
      )}
    </>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="wallet" size={23} />
          </span>
          <b>口袋账本</b>
        </div>
        <p className="sidebar-subtitle">把生活，慢慢记好。</p>
        <nav>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
              <span className="nav-dot" />
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <Icon name="shield" size={17} />
            <span>
              离线也能记账<small>本地保存 · 云同步可选</small>
            </span>
          </div>
          <span className="version">口袋账本 / 0.1</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">
              <Icon name="wallet" size={20} />
            </span>
            <b>口袋账本</b>
          </div>
          <span className="desktop-breadcrumb">
            我的空间 <Icon name="right" size={14} /> {navigation.find((n) => n.id === page)?.label}
          </span>
          <button className="book-switch" onClick={() => setPanel('books')}>
            <Icon name={book.archived ? 'archive' : 'book'} size={17} />
            {book.name}
            <Icon name="down" size={15} />
          </button>
        </header>
        <div className={`content page-${page}`}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === 'records'
                  ? '一笔一笔，都是生活'
                  : page === 'stats'
                    ? '每一种币种，单独看清'
                    : page === 'budget'
                      ? '花得有数，心里有底'
                      : '简单一点，安心一点'}
              </span>
              <h1>{viewTitle}</h1>
            </div>
            {page !== 'settings' && (
              <button
                className="primary desktop-add"
                disabled={readonly}
                onClick={() => setEditor({})}
              >
                <Icon name="plus" size={19} />
                记一笔
              </button>
            )}
          </div>
          {backupDue(state, book.id) && (
            <div className="backup-reminder" role="status">
              <Icon name="shield" size={20} />
              <span>
                账本有新变动，已超过 7 天未生成备份。
                <small>请把加密备份另存到手机外，换机时才能恢复。</small>
              </span>
              <button className="text-button" onClick={() => setPanel('backup')}>
                去备份
              </button>
            </div>
          )}
          {page !== 'settings' && <PwaPanel compact />}
          {readonly && (
            <div className="notice archive-notice">
              <Icon name="archive" />
              这个账本已归档。查看和导出仍可使用。
            </div>
          )}
          {page !== 'settings' && (
            <div className="view-toolbar">
              {page === 'records' && (
                <button className="secondary" onClick={() => setPanel('templates')}>
                  常用模板
                </button>
              )}
              <MonthPicker
                value={month}
                current={localTime(book.timezone).slice(0, 7)}
                onChange={setMonth}
              />
              {page === 'records' ? (
                <div className="currency-chips">
                  <button
                    className={currency === 'all' ? 'active' : ''}
                    onClick={() => setCurrency('all')}
                  >
                    全部币种
                  </button>
                  {Array.from(new Set([...book.common, ...all.map((e) => e.currency)])).map((c) => (
                    <button
                      key={c}
                      className={currency === c ? 'active' : ''}
                      onClick={() => setCurrency(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              ) : (
                <select
                  className="currency-select"
                  aria-label="统计预算币种"
                  value={statsCurrency}
                  onChange={(e) => setStatsCurrency(e.target.value as Currency)}
                >
                  {currencyCodes.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCIES[c].name} · {c}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {page === 'records' && (
            <>
              <div className="summary-grid">
                {displayedCurrencies.map((c, index) => {
                  const data = summarize(filteredWithoutCurrency, c);
                  return (
                    <section
                      className={`summary-card ${index === 0 ? 'warm' : ''}`}
                      key={c}
                      aria-label={`${c}收支摘要`}
                    >
                      <div className="card-top">
                        <span className="currency-symbol">{CURRENCIES[c].symbol}</span>
                        <span>
                          {CURRENCIES[c].name}
                          <small>{c}</small>
                        </span>
                        <span className="summary-caption">
                          {period === 'month' ? '本月' : period === 'year' ? '本年' : '所选期间'}
                          净支出
                        </span>
                      </div>
                      <div className="hero-amount">
                        <span>{c}</span>
                        {money(data.net, c, false)}
                      </div>
                      <div className="summary-bottom">
                        <span>
                          收入
                          <strong className="income-text">{money(data.income, c, false)}</strong>
                        </span>
                        <span>
                          收支结余<strong>{money(data.balance, c, false)}</strong>
                        </span>
                        <span className="summary-count">{data.count} 笔</span>
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="summary-footnote">
                <Icon name="coins" size={14} />
                不同币种分别统计，不换算、不相加。收支结余不代表账户余额。
              </div>
              <div className="records-layout">
                <section className="card records-card">
                  <div className="section-heading">
                    <h2>
                      收支明细 <span>{filtered.length}</span>
                    </h2>
                    <button
                      className={`text-button ${filterOpen ? 'accent' : ''}`}
                      onClick={() => setFilterOpen(!filterOpen)}
                    >
                      <Icon name="filter" size={17} />
                      筛选
                    </button>
                  </div>
                  <div className="search-wrap">
                    <Icon name="search" size={17} />
                    <input
                      aria-label="搜索备注"
                      placeholder="搜一搜备注里的小细节"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button"
                        aria-label="清除搜索"
                        onClick={() => setQuery('')}
                      >
                        <Icon name="x" size={16} />
                      </button>
                    )}
                  </div>
                  {filterOpen && (
                    <div className="filter-panel">
                      {periodControls}
                      <div className="filter-selects">
                        <select
                          aria-label="流水类型"
                          value={typeFilter}
                          onChange={(e) => setTypeFilter(e.target.value)}
                        >
                          <option value="">全部类型</option>
                          <option value="expense">支出</option>
                          <option value="income">收入</option>
                          <option value="refund">退款</option>
                        </select>
                        <select
                          aria-label="分类筛选"
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                        >
                          <option value="">全部分类</option>
                          {state.categories
                            .filter((c) => c.bookId === book.id)
                            .map((c) => (
                              <option value={c.id} key={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                        <select
                          aria-label="支付方式筛选"
                          value={paymentFilter}
                          onChange={(e) => setPaymentFilter(e.target.value)}
                        >
                          <option value="">全部支付方式</option>
                          <option value="none">未填写</option>
                          {state.payments
                            .filter((p) => p.bookId === book.id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <button className="text-button" onClick={clearFilters}>
                        清除筛选
                      </button>
                    </div>
                  )}
                  {filtered.length ? (
                    <div className="entry-groups">
                      {[...groups].map(([day, rows]) => (
                        <div key={day} className="day-group">
                          <div className="day-heading">
                            <span>
                              {day === localTime(book.timezone).slice(0, 10)
                                ? '今天'
                                : day.slice(5).replace('-', '月') + '日'}
                              <small>
                                {new Intl.DateTimeFormat('zh-CN', {
                                  weekday: 'short',
                                  timeZone: 'UTC',
                                }).format(new Date(day + 'T12:00:00Z'))}
                              </small>
                            </span>
                            <div>
                              {currencyCodes
                                .filter((c) => rows.some((e) => e.currency === c))
                                .map((c) => (
                                  <small key={c}>
                                    {c} 净支出{' '}
                                    {money(
                                      summarize(
                                        filtered.filter((e) => e.occurredAt.startsWith(day)),
                                        c,
                                      ).net,
                                      c,
                                      false,
                                    )}
                                  </small>
                                ))}
                            </div>
                          </div>
                          {rows.map((e) => {
                            const cat = state.categories.find((c) => c.id === e.categoryId);
                            const color =
                              categoryColors[
                                state.categories.findIndex((c) => c.id === e.categoryId) % 5
                              ];
                            return (
                              <button
                                className="entry-row"
                                key={e.id}
                                onClick={() => setDetailId(e.id)}
                              >
                                <span className={`category-icon ${color}`}>
                                  <Icon
                                    name={e.type === 'refund' ? 'refund' : (cat?.icon ?? 'dots')}
                                  />
                                </span>
                                <span className="entry-info">
                                  <b>
                                    {cat?.name}
                                    {e.type === 'refund' && <em>退款</em>}
                                  </b>
                                  <small>
                                    {e.note ||
                                      state.payments.find((p) => p.id === e.paymentId)?.name ||
                                      e.occurredAt.slice(11)}
                                  </small>
                                </span>
                                <span
                                  className={`entry-amount ${e.type === 'expense' ? '' : 'income-text'}`}
                                >
                                  <b>
                                    {e.type === 'expense' ? '−' : '+'}
                                    {money(e.amount, e.currency)}
                                  </b>
                                  <small>{e.occurredAt.slice(11)}</small>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title={all.length ? '这里暂时没有记录' : '第一笔，从今天开始'}
                      detail={
                        all.length
                          ? '试试其他币种、日期或筛选条件。'
                          : otherRecordCount > 0
                            ? `当前账本暂无记录，其他账本共有 ${otherRecordCount} 笔记录。切换账本即可查看。`
                            : '记下一笔小小的花费，让生活清晰一点。'
                      }
                      action={
                        <div className="empty-actions">
                          <button
                            className="primary"
                            disabled={readonly}
                            onClick={() => (all.length ? clearFilters() : setEditor({}))}
                          >
                            {all.length ? '重置筛选' : '记下第一笔'}
                            <Icon name={all.length ? 'refund' : 'plus'} size={16} />
                          </button>
                          {!all.length && otherRecordCount > 0 && (
                            <button className="secondary" onClick={openSyncedBooks}>
                              查看有记录的账本
                            </button>
                          )}
                          {all.length > 0 && (
                            <button
                              className="secondary"
                              onClick={() =>
                                setRequestedView({
                                  bookId: book.id,
                                  month: overview
                                    .find((row) => row.book.id === book.id)!
                                    .latest.slice(0, 7),
                                })
                              }
                            >
                              查看最近记录
                            </button>
                          )}
                        </div>
                      }
                    />
                  )}
                  {filtered.length > limit && (
                    <button className="load-more" onClick={() => setLimit(limit + 30)}>
                      再看 30 笔 <Icon name="down" size={16} />
                    </button>
                  )}
                </section>
                <aside className="right-rail">
                  <section className="card little-card">
                    <span className="tiny-label">记账小习惯</span>
                    <div className="habit-icon">
                      <Icon name="coffee" size={35} />
                    </div>
                    <h3>
                      不用记得完美，
                      <br />
                      记得开始就好。
                    </h3>
                    <p>日常开销用人民币，旅行开销用当地币种。慢慢记，清楚看。</p>
                    <div className="local-line">
                      <Icon name="shield" size={15} />
                      已保存的账目留在本机
                    </div>
                  </section>
                  <button className="backup-nudge" onClick={() => setPanel('backup')}>
                    <Icon name="download" size={22} />
                    <span>
                      <b>{state.backups[book.id] ? '给账本留一个副本' : '别忘了第一次备份'}</b>
                      <small>换机时，把生活一起带走</small>
                    </span>
                    <Icon name="right" size={17} />
                  </button>
                </aside>
              </div>
            </>
          )}
          {page === 'stats' && (
            <>
              <div className="stats-toolbar">
                {periodControls}
                <div className="segmented">
                  <button
                    className={statsType === 'expense' ? 'active' : ''}
                    onClick={() => setStatsType('expense')}
                  >
                    支出分析
                  </button>
                  <button
                    className={statsType === 'income' ? 'active' : ''}
                    onClick={() => setStatsType('income')}
                  >
                    收入分析
                  </button>
                </div>
              </div>
              <div className="stat-summary card">
                <div>
                  <span>{statsType === 'expense' ? '净支出' : '收入'}</span>
                  <strong>
                    {money(statsType === 'expense' ? summary.net : summary.income, statsCurrency)}
                  </strong>
                </div>
                <div>
                  <span>原始支出</span>
                  <b>{money(summary.expense, statsCurrency)}</b>
                </div>
                <div>
                  <span>退款</span>
                  <b>{money(summary.refunds, statsCurrency)}</b>
                </div>
                <div>
                  <span>收支结余</span>
                  <b>{money(summary.balance, statsCurrency)}</b>
                </div>
              </div>
              {period === 'month' && (
                <ComparisonPanel
                  key={`${book.id}/${month}`}
                  state={state}
                  book={book}
                  month={month}
                  currency={statsCurrency}
                  type={statsType}
                  onBudget={() => setPage('budget')}
                />
              )}
              <div className="stats-grid">
                <section className="card">
                  <div className="section-heading">
                    <h2>分类排行</h2>
                    <span className="subtle">{statsCurrency}</span>
                  </div>
                  {ranked.length ? (
                    <div className="rank-list">
                      {ranked.map((c, i) => (
                        <button
                          key={c.id}
                          className="rank-row"
                          onClick={() => {
                            setPage('records');
                            setCurrency(statsCurrency);
                            setCategoryFilter(c.id);
                            setTypeFilter('');
                            setPaymentFilter('');
                            setQuery('');
                            setFilterOpen(true);
                          }}
                        >
                          <span className={`category-icon ${categoryColors[i % 5]}`}>
                            <Icon name={c.icon} />
                          </span>
                          <div>
                            <div className="rank-label">
                              <b>{c.name}</b>
                              <span>{money(c.value, statsCurrency)}</span>
                            </div>
                            <div className="rank-track">
                              <span
                                className={c.value < 0 ? 'negative' : ''}
                                style={{ width: `${(Math.abs(c.value) / maxCategory) * 100}%` }}
                              />
                            </div>
                            <small>
                              {c.count} 笔记录
                              <Icon name="right" size={12} />
                            </small>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="还没有这个币种的记录"
                      detail="切换币种，或记下第一笔收支。"
                      icon="stats"
                    />
                  )}
                </section>
                <section className="card">
                  <div className="section-heading">
                    <h2>收支趋势</h2>
                    <span className="subtle">
                      按{period === 'year' ? '月' : '日'} · {statsCurrency}
                    </span>
                  </div>
                  {trend.length ? (
                    <>
                      <div
                        className="trend-chart"
                        role="img"
                        aria-label={`${statsCurrency} ${statsType === 'expense' ? '净支出' : '收入'}趋势，按日期显示`}
                      >
                        <div className="chart-zero" />
                        {trend.map(([day, value]) => (
                          <div
                            className="trend-column"
                            key={day}
                            title={`${day} ${money(value, statsCurrency)}`}
                          >
                            <div
                              className={`trend-bar ${value < 0 ? 'negative' : ''}`}
                              style={{
                                height: `${Math.max(2, (Math.abs(value) / maxTrend) * 44)}%`,
                                ...(value < 0 ? { top: '50%' } : { bottom: '50%' }),
                              }}
                            />
                            <small>{day.slice(period === 'year' ? 5 : 8)}</small>
                          </div>
                        ))}
                      </div>
                      <p className="chart-note">
                        上方为正值，下方为负值。退款较多时，净支出可能为负。
                      </p>
                      <div className="trend-values">
                        {trend.map(([d, v]) => (
                          <span key={d}>
                            {d} <b>{money(v, statsCurrency)}</b>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="等生活留下第一条曲线"
                      detail="记录收支后，在这里查看变化。"
                      icon="stats"
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {page === 'budget' && (
            <>
              <section className="card budget-hero">
                <div className="budget-copy">
                  <span className="eyebrow">
                    {month} / {CURRENCIES[statsCurrency].name}
                  </span>
                  <h2>
                    {budget
                      ? ratio > 1
                        ? '稍微超了一点，下次再调整。'
                        : '把钱花在，真正想要的地方。'
                      : '为这个月，定一个小计划。'}
                  </h2>
                  <p>
                    {budget
                      ? `本月总预算 ${money(budget.amount, statsCurrency)}`
                      : `还没有设置 ${statsCurrency} 预算，其他币种额度不会在这里使用。`}
                  </p>
                  <button
                    className="primary"
                    onClick={() => setPanel('budget')}
                    disabled={readonly}
                  >
                    <Icon name={budget ? 'edit' : 'plus'} size={17} />
                    {budget ? '调整预算' : '设置本月预算'}
                  </button>
                </div>
                <div
                  className={`budget-ring ${ratio > 1 ? 'over' : ''}`}
                  style={{ '--progress': `${Math.min(100, ratio * 100)}%` } as React.CSSProperties}
                >
                  <div>
                    <span>{budget ? `${Math.round(ratio * 100)}%` : '—'}</span>
                    <small>
                      {budget
                        ? ratio > 1
                          ? '已超支'
                          : ratio >= 1
                            ? '已用完'
                            : ratio >= 0.8
                              ? '接近预算'
                              : '预算已使用'
                        : '等待你的计划'}
                    </small>
                  </div>
                </div>
              </section>
              {budget && (
                <>
                  <div className="budget-metrics">
                    <div className="card">
                      <span>已使用</span>
                      <strong>{money(used, statsCurrency)}</strong>
                    </div>
                    <div className="card">
                      <span>{ratio > 1 ? '超支金额' : '剩余额度'}</span>
                      <strong className={ratio > 1 ? 'expense-text' : 'income-text'}>
                        {money(Math.abs(budget.amount - used), statsCurrency)}
                      </strong>
                    </div>
                    <div className="card">
                      <span>分类未分配</span>
                      <strong>
                        {money(
                          budget.amount -
                            Object.values(budget.categories).reduce((a, b) => a + b, 0),
                          statsCurrency,
                        )}
                      </strong>
                    </div>
                  </div>
                  <section className="card">
                    <div className="section-heading">
                      <h2>分类预算</h2>
                      <span className="subtle">{Object.keys(budget.categories).length} 项</span>
                    </div>
                    {Object.entries(budget.categories).length ? (
                      Object.entries(budget.categories).map(([id, amount]) => {
                        const cat = state.categories.find((c) => c.id === id)!;
                        const spent = Math.max(
                          0,
                          summarize(
                            monthRows.filter((e) => e.categoryId === id),
                            statsCurrency,
                          ).net,
                        );
                        return (
                          <div className="category-budget-row" key={id}>
                            <div>
                              <Icon name={cat.icon} />
                              <b>{cat.name}</b>
                              <span>
                                {money(spent, statsCurrency)}{' '}
                                <small>/ {money(amount, statsCurrency, false)}</small>
                              </span>
                            </div>
                            <div className="rank-track">
                              <span
                                className={spent > amount ? 'over' : ''}
                                style={{ width: `${Math.min(100, (spent / amount) * 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <Empty
                        title="给重点开销留个额度"
                        detail="分类预算是可选的，可以从餐饮、购物开始。"
                        icon="target"
                      />
                    )}
                  </section>
                  <p className="summary-footnote">
                    退款按发生月份冲减；净支出为负时预算已用为零。各分类的已用之和可能不等于总预算已用。
                  </p>
                </>
              )}
            </>
          )}
          {page === 'settings' && (
            <>
              <section className="privacy-card">
                <div className="privacy-icon">
                  <Icon name="shield" size={32} />
                </div>
                <div>
                  <h2>生活的细节，留在你的口袋里。</h2>
                  <p>
                    默认仅保存在本机。可选择开启加密云同步；记账、统计和本地备份都可以离线完成。
                  </p>
                </div>
              </section>
              <div className="settings-grid">
                <section className="card">
                  <h2 className="settings-title">我的账本</h2>
                  {[
                    {
                      icon: 'receipt',
                      title: '常用模板',
                      desc: '早餐、通勤、房租，预填后确认记账',
                      panel: 'templates',
                    },
                    {
                      icon: 'book',
                      title: '账本管理',
                      desc: `${state.books.filter((b) => !b.deletedAt).length} 个本地账本 · 默认币种与常用币种`,
                      panel: 'books',
                    },
                    {
                      icon: 'folder',
                      title: '分类与支付方式',
                      desc: '整理你自己的生活分类',
                      panel: 'categories',
                    },
                    {
                      icon: 'trash',
                      title: '回收站',
                      desc: '已删除记录保留 30 天',
                      panel: 'trash',
                    },
                  ].map((item) => (
                    <button
                      className="settings-row"
                      key={item.panel}
                      onClick={() => setPanel(item.panel as Panel)}
                    >
                      <span className="category-icon">
                        <Icon name={item.icon} />
                      </span>
                      <span>
                        <b>{item.title}</b>
                        <small>{item.desc}</small>
                      </span>
                      <Icon name="right" size={18} />
                    </button>
                  ))}
                </section>
                <section className="card">
                  <h2 className="settings-title">数据与备份</h2>
                  <button className="settings-row" onClick={() => setPanel('backup')}>
                    <span className="category-icon green">
                      <Icon name="download" />
                    </span>
                    <span>
                      <b>导出、备份与恢复</b>
                      <small>
                        {state.backups[book.id]
                          ? `最近生成 ${new Date(state.backups[book.id]).toLocaleDateString('zh-CN')}${book.updatedAt > state.backups[book.id] ? ' · 此后有新修改' : ''}`
                          : '尚未生成当前账本备份'}
                      </small>
                    </span>
                    <Icon name="right" size={18} />
                  </button>
                  <div className="settings-explainer">
                    <Icon name="info" size={17} />
                    <p>
                      生成文件不代表已保存到手机外。卸载、手机遗失或损坏后，需要你留存的备份才能恢复。
                    </p>
                  </div>
                  <button className="settings-row danger-text" onClick={() => setPanel('clear')}>
                    <span className="category-icon">
                      <Icon name="trash" />
                    </span>
                    <span>
                      <b>清空全部本地数据</b>
                      <small>不可撤销，请先导出备份</small>
                    </span>
                    <Icon name="right" size={18} />
                  </button>
                </section>
              </div>
              <SyncPanel onOpenBooks={openSyncedBooks} />
              <PwaPanel />
              <div className="about-note">
                <b>口袋账本 0.1</b>
                <p>
                  {isNative
                    ? '原生本地存储 · 加密 SQLite'
                    : '网页应用 · 本地浏览器存储，云同步单独加密；本机存储未加密'}
                  <br />
                  同一设备的账本不做成员权限隔离。支付方式是标签，不管理余额。
                </p>
              </div>
            </>
          )}
          <footer className="content-footer">
            <span>小小记录，好好生活。</span>
            <SyncStatusButton onOpen={() => setPage('settings')} />
            <span>
              <Icon name="shield" size={13} />
              本地保存
            </span>
          </footer>
        </div>
      </main>
      <nav className="bottom-nav">
        {navigation.map((item, i) => (
          <button
            key={item.id}
            className={`${page === item.id ? 'active' : ''} ${i === 2 ? 'after-add' : ''}`}
            onClick={() => setPage(item.id)}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </button>
        ))}
        <button
          className="mobile-add"
          aria-label="记一笔"
          onClick={() => setEditor({})}
          disabled={readonly}
        >
          <Icon name="plus" size={27} />
        </button>
      </nav>
      {editor && (
        <EntryEditor
          key={
            editor.entry?.id ??
            editor.refund?.id ??
            editor.repeat?.id ??
            editor.template?.id ??
            'new'
          }
          book={book}
          currency={page === 'records' && currency !== 'all' ? currency : book.currency}
          entry={editor.entry}
          refund={editor.refund}
          repeat={editor.repeat}
          template={editor.template}
          onClose={() => setEditor(null)}
        />
      )}
      {detail && !editor && (
        <EntryDetail
          entry={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setEditor({ entry: detail });
            setDetailId(null);
          }}
          onRefund={() => {
            setEditor({ refund: detail });
            setDetailId(null);
          }}
          onRepeat={() => {
            setEditor({ repeat: detail });
            setDetailId(null);
          }}
        />
      )}
      {panel === 'templates' && (
        <TemplatesDialog
          book={book}
          onClose={() => setPanel(null)}
          onUse={(template) => {
            setPanel(null);
            setEditor({ template });
          }}
        />
      )}
      {panel === 'books' && (
        <BooksDialog
          onClose={() => {
            setPanel(null);
            setBrowseSyncedBooks(false);
          }}
          onViewRecords={
            browseSyncedBooks ? (bookId, month) => setRequestedView({ bookId, month }) : undefined
          }
        />
      )}
      {panel === 'budget' && (
        <BudgetEditor
          book={book}
          currency={statsCurrency}
          month={month}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'trash' && <TrashDialog book={book} onClose={() => setPanel(null)} />}
      {panel === 'categories' && <CategoriesDialog book={book} onClose={() => setPanel(null)} />}
      {panel === 'backup' && <BackupDialog book={book} onClose={() => setPanel(null)} />}
      {panel === 'clear' && <ClearDialog onClose={() => setPanel(null)} />}
    </div>
  );
}
