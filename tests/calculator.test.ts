import { describe, expect, it } from 'vitest';
import { amountText, calculateMoney, type Currency } from '../src/money';

describe('amount addition and subtraction', () => {
  it.each([
    ['18+12.5', 'CNY', 3050],
    ['100-20', 'HKD', 8000],
    ['0.1+0.2', 'CNY', 30],
    ['0.3-0.1-0.2+0.01', 'CNY', 1],
    ['0-2+3', 'USD', 100],
    ['18 + 12.50 − 0.5', 'EUR', 3000],
    ['001＋2－0.01', 'CNY', 299],
    ['1200+300-50', 'JPY', 1450],
    ['99999999.98+0.01', 'CNY', 9999999999],
    ['99999999+99999999-99999999', 'JPY', 99999999],
    ['28.50', 'CNY', 2850],
  ] as [string, Currency, number][])(
    '%s in %s yields exactly %i minor units',
    (input, currency, expected) => {
      expect(calculateMoney(input, currency)).toBe(expected);
      expect(Number.isSafeInteger(calculateMoney(input, currency))).toBe(true);
    },
  );

  it.each([
    '',
    '18+',
    '18--2',
    '+18',
    '-18',
    '1+-2',
    '1 2+3',
    '1*2',
    '(1+2)',
    '1e2+3',
    'NaN+1',
    'Infinity',
    '1,000+2',
    '0.001+1',
    '1+0.001',
    '10-10',
    '10-20',
    '0+0',
    '99999999.99+0.01',
    '1+'.repeat(20) + '1',
    'alert(1)',
  ])('rejects invalid, unfinished or out-of-range input %s', (input) => {
    expect(() => calculateMoney(input, 'CNY')).toThrow();
  });

  it('validates every operand against the selected currency without rounding', () => {
    expect(() => calculateMoney('1.5+0.5', 'JPY')).toThrow('整数');
    expect(() => calculateMoney('10+0.00', 'JPY')).toThrow('整数');
    expect(() => calculateMoney('0.001+0.009', 'CNY')).toThrow('两位小数');
    expect(amountText(calculateMoney('1.5+0.5', 'HKD'), 'HKD')).toBe('2.00');
  });
});
