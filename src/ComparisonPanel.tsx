import { t, useLocale } from './i18n';
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
  useLocale();
  const [samePeriod, setSamePeriod] = useState(true),
    [expanded, setExpanded] = useState(false);
  const today = localTime(book.timezone).slice(0, 10);
  const data = useMemo(
    () => monthComparison(state, book.id, currency, month, samePeriod, today),
    [state, book.id, currency, month, samePeriod, today],
  );
  const categories = data.categories.filter((c) => c.type === type);
  return (
    <section className="card month-comparison" aria-label={t('{0} 月度对比', [currency])}>
      <div className="section-heading">
        <h2>{t('月度对比')}</h2>
        <span className="subtle">{currency}</span>
      </div>
      {month === today.slice(0, 7) && (
        <div className="segmented comparison-toggle" aria-label={t('对比范围')}>
          <button
            aria-pressed={samePeriod}
            className={samePeriod ? 'active' : ''}
            onClick={() => setSamePeriod(true)}
          >
            {t('截至今日对比')}
          </button>
          <button
            aria-pressed={!samePeriod}
            className={!samePeriod ? 'active' : ''}
            onClick={() => setSamePeriod(false)}
          >
            {t('整月对比')}
          </button>
        </div>
      )}
      <p className="comparison-range">
        {t('本期 ')}
        {month}
        {t('-01 至 ')}
        {data.end}
        <br />
        {data.previous
          ? t('上期 {0}-01 至 {1}', [data.previous, data.previousEnd])
          : t('已到最早月份，无上期可比')}
      </p>
      <p className="comparison-note">
        {data.partial
          ? t('当前月按截至今天的日期对比；上月不足同日时取月末。')
          : month === today.slice(0, 7)
            ? t('本月尚未结束，已记至 {0}；上期取完整月份。', [today])
            : t('按所选月份与前一个完整月份对比。')}
        {t('退款按发生日期冲减支出；结余不代表账户余额。')}
      </p>
      <div className="comparison-metrics">
        {(
          [
            { key: 'income', label: t('收入') },
            { key: 'net', label: t('净支出') },
            { key: 'balance', label: t('收支结余') },
          ] as const
        ).map(({ key, label }) => (
          <div className="comparison-metric" key={key} aria-label={t('{0}对比', [label])}>
            <span>{label}</span>
            <strong>{money(data.current[key], currency)}</strong>
            <span>
              {t('上期 ')}
              {money(data.prior[key], currency)}
            </span>
            <p>
              {data.previous
                ? changeText(data.current[key], data.prior[key], currency, data.prior.count)
                : t('无上期可比')}
            </p>
          </div>
        ))}
      </div>
      {!data.current.count && !data.prior.count && (
        <p className="comparison-note">
          {t('两个期间都没有 ')}
          {currency}
          {t(' 记录，记账后即可比较。')}
        </p>
      )}
      <div className="comparison-budget" aria-label={t('{0} 预算剩余', [currency])}>
        <div>
          <h3>
            {month}
            {t(' 月预算')}
          </h3>
          {data.budget ? (
            <>
              <strong>
                {data.budget.remaining < 0 ? t('已超支') : t('剩余')}{' '}
                {money(Math.abs(data.budget.remaining), currency)}
              </strong>
              <p>
                {t('预算 ')}
                {money(data.budget.amount, currency)}
                {t(' · 已用')} {money(data.budget.used, currency)}
              </p>
            </>
          ) : (
            <p>{t('该月未设置 {0} 预算', [currency])}</p>
          )}
        </div>
        <button className="secondary" onClick={onBudget}>
          {t('查看预算')}
        </button>
        <p className="comparison-note">
          {t('预算按该月全部记录计算，已用取净支出与零的较大值，不随上方对比范围变化。')}
        </p>
      </div>
      <div className="section-heading">
        <h3>{type === 'expense' ? t('支出分类变化') : t('收入分类变化')}</h3>
        <span className="subtle">{t('按变动金额排序')}</span>
      </div>
      <div className="comparison-categories">
        {(expanded ? categories : categories.slice(0, 6)).map((c) => (
          <article className="comparison-category" key={c.id} aria-label={t('{0}变化', [c.name])}>
            <b>
              {c.name}
              {!c.active ? t('（已停用）') : ''}
            </b>
            <p>{changeText(c.current, c.previous, currency, c.previousCount)}</p>
            <div>
              <span>
                {t('本期 ')}
                {money(c.current, currency)}
              </span>
              <span>
                {t('上期 ')}
                {money(c.previous, currency)}
              </span>
            </div>
          </article>
        ))}
        {!categories.length && (
          <p className="comparison-note">
            {t('两个期间都没有')}
            {type === 'expense' ? t('支出或退款') : t('收入')}
            {t('记录。')}
          </p>
        )}
      </div>
      {categories.length > 6 && (
        <button className="text-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('收起分类') : t('查看全部 {0} 个分类', [categories.length])}
        </button>
      )}
      <p className="comparison-note">
        {t('上期无记录、为零或为负时只比较金额，不计算百分比。不同币种不合并。')}
      </p>
    </section>
  );
}
