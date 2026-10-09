import { useMemo, useState } from 'react';
import { type Book, type State, localTime } from './model';
import { money, type Currency } from './money';
import { changeText, monthComparison } from './comparison';

export function ComparisonPanel({
  state,
  book,
  month,
  currency,
  type,
  onBudget,
}: {
  state: State;
  book: Book;
  month: string;
  currency: Currency;
  type: 'expense' | 'income';
  onBudget: () => void;
}) {
  const [samePeriod, setSamePeriod] = useState(true),
    [expanded, setExpanded] = useState(false);
  const today = localTime(book.timezone).slice(0, 10);
  const data = useMemo(
    () => monthComparison(state, book.id, currency, month, samePeriod, today),
    [state, book.id, currency, month, samePeriod, today],
  );
  const categories = data.categories.filter((c) => c.type === type);
  return (
    <section className="card month-comparison" aria-label={`${currency} 月度对比`}>
      <div className="section-heading">
        <h2>月度对比</h2>
        <span className="subtle">{currency}</span>
      </div>
      {month === today.slice(0, 7) && (
        <div className="segmented comparison-toggle" aria-label="对比范围">
          <button
            aria-pressed={samePeriod}
            className={samePeriod ? 'active' : ''}
            onClick={() => setSamePeriod(true)}
          >
            截至今日对比
          </button>
          <button
            aria-pressed={!samePeriod}
            className={!samePeriod ? 'active' : ''}
            onClick={() => setSamePeriod(false)}
          >
            整月对比
          </button>
        </div>
      )}
      <p className="comparison-range">
        本期 {month}-01 至 {data.end}
        <br />
        {data.previous
          ? `上期 ${data.previous}-01 至 ${data.previousEnd}`
          : '已到最早月份，无上期可比'}
      </p>
      <p className="comparison-note">
        {data.partial
          ? '当前月按截至今天的日期对比；上月不足同日时取月末。'
          : month === today.slice(0, 7)
            ? `本月尚未结束，已记至 ${today}；上期取完整月份。`
            : '按所选月份与前一个完整月份对比。'}
        退款按发生日期冲减支出；结余不代表账户余额。
      </p>
      <div className="comparison-metrics">
        {(
          [
            { key: 'income', label: '收入' },
            { key: 'net', label: '净支出' },
            { key: 'balance', label: '收支结余' },
          ] as const
        ).map(({ key, label }) => (
          <div className="comparison-metric" key={key} aria-label={`${label}对比`}>
            <span>{label}</span>
            <strong>{money(data.current[key], currency)}</strong>
            <span>上期 {money(data.prior[key], currency)}</span>
            <p>
              {data.previous
                ? changeText(data.current[key], data.prior[key], currency, data.prior.count)
                : '无上期可比'}
            </p>
          </div>
        ))}
      </div>
      {!data.current.count && !data.prior.count && (
        <p className="comparison-note">两个期间都没有 {currency} 记录，记账后即可比较。</p>
      )}
      <div className="comparison-budget" aria-label={`${currency} 预算剩余`}>
        <div>
          <h3>{month} 月预算</h3>
          {data.budget ? (
            <>
              <strong>
                {data.budget.remaining < 0 ? '已超支' : '剩余'}{' '}
                {money(Math.abs(data.budget.remaining), currency)}
              </strong>
              <p>
                预算 {money(data.budget.amount, currency)} · 已用{' '}
                {money(data.budget.used, currency)}
              </p>
            </>
          ) : (
            <p>该月未设置 {currency} 预算</p>
          )}
        </div>
        <button className="secondary" onClick={onBudget}>
          查看预算
        </button>
        <p className="comparison-note">
          预算按该月全部记录计算，已用取净支出与零的较大值，不随上方对比范围变化。
        </p>
      </div>
      <div className="section-heading">
        <h3>{type === 'expense' ? '支出分类变化' : '收入分类变化'}</h3>
        <span className="subtle">按变动金额排序</span>
      </div>
      <div className="comparison-categories">
        {(expanded ? categories : categories.slice(0, 6)).map((c) => (
          <article className="comparison-category" key={c.id} aria-label={`${c.name}变化`}>
            <b>
              {c.name}
              {!c.active ? '（已停用）' : ''}
            </b>
            <p>{changeText(c.current, c.previous, currency, c.previousCount)}</p>
            <div>
              <span>本期 {money(c.current, currency)}</span>
              <span>上期 {money(c.previous, currency)}</span>
            </div>
          </article>
        ))}
        {!categories.length && (
          <p className="comparison-note">
            两个期间都没有{type === 'expense' ? '支出或退款' : '收入'}记录。
          </p>
        )}
      </div>
      {categories.length > 6 && (
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起分类' : `查看全部 ${categories.length} 个分类`}
        </button>
      )}
      <p className="comparison-note">
        上期无记录、为零或为负时只比较金额，不计算百分比。不同币种不合并。
      </p>
    </section>
  );
}
