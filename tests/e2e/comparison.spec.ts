import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-09T04:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: '开启我的账本' }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('pocket-ledger-preview', 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('vault', 'readwrite'),
        store = t.objectStore('vault'),
        req = store.get('state');
      req.onsuccess = () => {
        const s = req.result,
          bookId = s.books[0].id;
        const food = s.categories.find((c: any) => c.name === '餐饮').id,
          transport = s.categories.find((c: any) => c.name === '交通').id,
          income = s.categories.find((c: any) => c.type === 'income').id;
        const entry = (
          id: string,
          type: string,
          amount: number,
          date: string,
          categoryId = food,
          currency = 'CNY',
          originalId?: string,
        ) => ({
          id,
          bookId,
          type,
          amount,
          categoryId,
          currency,
          originalId,
          note: '',
          occurredAt: date + 'T12:00',
          createdAt: 1,
          updatedAt: 1,
        });
        const original = crypto.randomUUID();
        s.entries = [
          entry(original, 'expense', 10000, '2026-09-09'),
          entry(crypto.randomUUID(), 'expense', 2000, '2026-09-20'),
          entry(crypto.randomUUID(), 'expense', 3000, '2026-09-04', transport),
          entry(crypto.randomUUID(), 'expense', 6000, '2026-10-09'),
          entry(crypto.randomUUID(), 'refund', 2000, '2026-10-09', food, 'CNY', original),
          entry(crypto.randomUUID(), 'income', 20000, '2026-10-09', income),
          entry(crypto.randomUUID(), 'expense', 7777, '2026-10-09', food, 'HKD'),
          entry(crypto.randomUUID(), 'expense', 900, '2026-10-09', food, 'JPY'),
        ];
        s.budgets = [{ bookId, currency: 'CNY', month: '2026-10', amount: 10000, categories: {} }];
        store.put(s, 'state');
      };
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: '统计', exact: true }).filter({ visible: true }).click();
});
test('monthly comparison respects date range, refunds, currency and budget', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'CNY 月度对比' });
  await expect(panel).toContainText('上期 2026-09-01 至 2026-09-09');
  await expect(panel.getByLabel('净支出对比', { exact: true })).toContainText('CNY 40.00');
  await expect(panel.getByLabel('净支出对比', { exact: true })).toContainText('上期 CNY 130.00');
  await expect(panel.getByLabel('收支结余对比')).toContainText('CNY 160.00');
  await expect(panel.getByLabel('CNY 预算剩余')).toContainText('剩余 CNY 60.00');
  await expect(panel.getByLabel('交通变化')).toContainText('减少 CNY 30.00');
  await panel.getByRole('button', { name: '整月对比', exact: true }).click();
  await expect(panel.getByLabel('净支出对比', { exact: true })).toContainText('上期 CNY 150.00');
  await page.getByRole('button', { name: '收入分析', exact: true }).click();
  await expect(panel.getByRole('button', { name: '整月对比', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel).toContainText('收入分类变化');
  await expect(panel.getByLabel('工资变化')).toContainText('CNY 200.00');
  await page.getByLabel('统计预算币种').selectOption('JPY');
  const yen = page.getByRole('region', { name: 'JPY 月度对比' });
  await expect(yen.getByLabel('净支出对比', { exact: true })).toContainText('JPY 900');
  await expect(yen.getByLabel('JPY 预算剩余')).toContainText('未设置 JPY 预算');
  await expect(yen).not.toContainText('CNY');
  await expect(yen).not.toContainText('900.00');
  await yen.getByRole('button', { name: '查看预算' }).click();
  await expect(page.locator('.budget-hero')).toContainText('JPY');
});
test('historical month compares complete months; year and custom periods do not show monthly comparison', async ({
  page,
}) => {
  await page.getByRole('button', { name: '上一个月', exact: true }).click();
  const panel = page.getByRole('region', { name: 'CNY 月度对比' });
  await expect(panel).toContainText('本期 2026-09-01 至 2026-09-30');
  await expect(panel).toContainText('上期 2026-08-01 至 2026-08-31');
  await expect(panel.getByLabel('净支出对比', { exact: true })).toContainText('CNY 150.00');
  await expect(panel).toContainText('上期无记录');
  await page.getByRole('button', { name: '年度', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await expect(panel).toHaveCount(0);
});
test('comparison remains readable at narrow widths and enlarged text', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({
    content:
      '.month-comparison {font-size:20px} .month-comparison span,.month-comparison p {font-size:18px}',
  });
  const panel = page.getByRole('region', { name: 'CNY 月度对比' });
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('comparison-narrow.png') });
  await expect(panel.getByRole('button', { name: '查看预算' })).toBeVisible();
});

