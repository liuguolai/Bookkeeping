import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import english from '../src/locales/en.json';
import traditional from '../src/locales/zh-TW.json';
import { detectLocale, getLocale, messageText, monthText, setLocale, translate } from '../src/i18n';
import { createBook } from '../src/domain';
import { emptyState } from '../src/model';
import { exportCsv } from '../src/backup';

afterEach(() => setLocale('zh-CN'));

describe('language selection and formatting', () => {
  it.each([
    [['zh-CN'], 'zh-CN'],
    [['zh-Hans-SG'], 'zh-CN'],
    [['zh-Hant'], 'zh-TW'],
    [['zh-TW'], 'zh-TW'],
    [['zh-HK'], 'zh-TW'],
    [['zh-MO'], 'zh-TW'],
    [['en-GB'], 'en'],
    [['fr-FR', 'en-US'], 'en'],
    [['fr-FR'], 'zh-CN'],
  ] as const)('resolves %j to %s', (languages, expected) => {
    expect(detectLocale(languages)).toBe(expected);
  });

  it('preserves interpolation values, unknown messages and literal braces', () => {
    expect(translate('删除“{0}”不会影响已有记录。', 'en', ['{1} & <name>'])).toBe(
      'Deleting “{1} & <name>” will not affect existing entries.',
    );
    expect(translate('Unknown server error', 'en')).toBe('Unknown server error');
    expect(translate('toString', 'en')).toBe('toString');
  });

  it('translates stored statuses and server errors after switching', () => {
    setLocale('en');
    expect(messageText('账号或密码不正确')).toBe('Incorrect username or password');
    setLocale('zh-TW');
    expect(messageText('Synced')).toBe('已同步');
    expect(messageText('日元金额只能填写整数')).toBe('日元金額只能填寫整數');
  });

  it('formats months without changing dates or currencies', () => {
    setLocale('en');
    expect(monthText('2026-10')).toBe('October 2026');
    setLocale('zh-CN');
    expect(monthText('2026-10')).toBe('2026年10月');
    setLocale('zh-TW');
    expect(monthText('0001-01')).toContain('1');
    expect(getLocale()).toBe('zh-TW');
  });

  it('localizes new defaults and CSV headers but preserves existing user data', () => {
    const state = emptyState();
    const original = createBook(state, '我的生活', 'CNY');
    const before = JSON.stringify(state);
    setLocale('en');
    expect(JSON.stringify(state)).toBe(before);
    const added = createBook(state, 'My ledger', 'USD');
    expect(state.categories.find((c) => c.bookId === added.id)?.name).toBe('Dining');
    expect(state.payments.find((p) => p.bookId === added.id)?.name).toBe('WeChat Pay');
    expect(state.categories.find((c) => c.bookId === original.id)?.name).toBe('餐饮');
    expect(exportCsv(state, [])).toContain('"Transaction ID","Ledger","Type"');
  });
});

describe('translation coverage', () => {
  it('has matching keys and interpolation placeholders in both catalogs', () => {
    expect(Object.keys(traditional).sort()).toEqual(Object.keys(english).sort());
    const placeholders = (value: string) => [...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
    for (const [key, value] of Object.entries(english)) {
      expect(value.length, key).toBeGreaterThan(0);
      expect(value, key).not.toMatch(/[\u3400-\u9fff]/);
      expect(placeholders(value), key).toEqual(placeholders(key));
      expect(placeholders(traditional[key as keyof typeof traditional]), key).toEqual(
        placeholders(key),
      );
    }
  });

  it('covers every translation call and server error without runtime fallback', () => {
    const files = readdirSync('src', { recursive: true })
      .map(String)
      .filter((f) => /\.tsx?$/.test(f));
    const missing = new Set<string>();
    for (const file of [
      ...files.map((f) => `src/${f}`),
      'worker/index.ts',
      'scripts/sw-template.js',
    ]) {
      const ast = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) && /[\u3400-\u9fff]/.test(node.text)) {
          const call = node.parent;
          const needsTranslation =
            file.startsWith('worker/') ||
            file.endsWith('sw-template.js') ||
            (ts.isCallExpression(call) && ['t', 'tr'].includes(call.expression.getText(ast)));
          if (needsTranslation && !Object.hasOwn(english, node.text)) missing.add(node.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect([...missing]).toEqual([]);
  });
});
