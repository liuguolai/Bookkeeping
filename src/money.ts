export const CURRENCIES = {
  CNY: { name: '人民币', alias: 'RMB', precision: 2, symbol: '¥' },
  HKD: { name: '港币', alias: '', precision: 2, symbol: 'HK$' },
  MOP: { name: '澳门元', alias: '', precision: 2, symbol: 'MOP$' },
  USD: { name: '美元', alias: '', precision: 2, symbol: '$' },
  EUR: { name: '欧元', alias: '', precision: 2, symbol: '€' },
  GBP: { name: '英镑', alias: '', precision: 2, symbol: '£' },
  JPY: { name: '日元', alias: '', precision: 0, symbol: '¥' },
  SGD: { name: '新加坡元', alias: '', precision: 2, symbol: 'S$' },
} as const;
export type Currency = keyof typeof CURRENCIES;
export const currencyCodes = Object.keys(CURRENCIES) as Currency[];
function parseMoneyUnits(text: string, currency: Currency): number {
  const p = CURRENCIES[currency].precision;
  const value = text.trim();
  if (!(p === 0 ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(value))
    throw new Error(p === 0 ? '日元金额只能填写整数' : '请输入金额，最多保留两位小数');
  const [whole, fraction = ''] = value.split('.');
  const n = Number(whole) * 10 ** p + Number(fraction.padEnd(p, '0'));
  if (!Number.isSafeInteger(n) || n >= 10 ** (8 + p)) throw new Error('金额必须大于零，且小于一亿');
  return n;
}
export function parseMoney(text: string, currency: Currency): number {
  const value = parseMoneyUnits(text, currency);
  if (value <= 0) throw new Error('金额必须大于零，且小于一亿');
  return value;
}

// Calculate in integer minor units; never evaluate input as JavaScript or round it.
export function calculateMoney(text: string, currency: Currency): number {
  if (text.length > 40) throw new Error('金额算式最多 40 个字符');
  const expression = text.trim().replace(/＋/g, '+').replace(/[−－]/g, '-');
  if (!/[+-]/.test(expression)) return parseMoney(expression, currency);
  const parts = expression.split(/([+-])/);
  if (parts.some((part) => !part.trim())) throw new Error('请补全算式，例如 18+12.5 或 100-20');
  let total = parseMoneyUnits(parts[0], currency);
  for (let i = 1; i < parts.length; i += 2) {
    const value = parseMoneyUnits(parts[i + 1], currency);
    total = addMoney([total, parts[i] === '+' ? value : -value]);
  }
  if (total <= 0 || total >= 10 ** (8 + CURRENCIES[currency].precision))
    throw new Error('计算结果必须大于零，且小于一亿');
  return total;
}
export function amountText(minor: number, currency: Currency): string {
  const p = CURRENCIES[currency].precision;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return sign + Math.floor(abs / 10 ** p) + (p ? '.' + String(abs % 10 ** p).padStart(p, '0') : '');
}
export function money(minor: number, currency: Currency, withCode = true): string {
  const [whole, fraction] = amountText(minor, currency).split('.');
  const display =
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
  return withCode ? `${currency} ${display}` : display;
}
export function addMoney(values: number[]): number {
  const result = values.reduce((sum, n) => sum + n, 0);
  if (!Number.isSafeInteger(result)) throw new Error('金额汇总超出精确计算范围');
  return result;
}
