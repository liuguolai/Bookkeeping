import { test, expect, type Page } from '@playwright/test';

async function openEntry(page: Page) {
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  return page.getByLabel('金额', { exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开启我的账本' }).click();
});

test('calculator buttons keep focus and save the exact result', async ({ page }) => {
  const amount = await openEntry(page);
  await expect(amount).toBeFocused();
  await amount.fill('18');
  await page.getByRole('button', { name: '加一项金额', exact: true }).click();
  await expect(amount).toBeFocused();
  await page.keyboard.type('12.5');
  await expect(amount).toHaveValue('18+12.5');
  await expect(page.locator('#amount-calculation-hint')).toContainText('CNY 30.50');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(amount).toHaveValue('');
  await expect(amount).toBeFocused();
  await amount.fill('0.1+0.2');
  await page.getByRole('button', { name: '计算结果', exact: true }).click();
  await expect(amount).toHaveValue('0.30');
  await expect(amount).toBeFocused();
  await amount.press('End');
  await page.getByRole('button', { name: '减一项金额', exact: true }).click();
  await page.keyboard.type('0.1');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(2);
  await expect(page.locator('.entry-row').filter({ hasText: '30.50' })).toHaveCount(1);
  await expect(page.locator('.entry-row').filter({ hasText: '0.20' })).toHaveCount(1);
});

test('unfinished drafts restore and invalid results retain the expression', async ({ page }) => {
  const amount = await openEntry(page);
  await amount.fill('100-');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '记一笔', exact: true })).not.toBeVisible();
  await page.reload();
  await openEntry(page);
  await expect(amount).toHaveValue('100-');
  await page.getByRole('button', { name: '计算结果', exact: true }).click();
  await expect(page.locator('#amount-calculation-hint')).toContainText('请补全算式');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await amount.press('End');
  await page.getByRole('button', { name: '加一项金额', exact: true }).click();
  await page.keyboard.type('0.5');
  await expect(amount).toHaveValue('100+0.5');
  await page.getByLabel('记账币种').selectOption('JPY');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('#amount-calculation-hint')).toContainText('整数');
  await expect(amount).toHaveValue('100+0.5');
  await page.getByLabel('记账币种').selectOption('HKD');
  await amount.fill('10-20');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('#amount-calculation-hint')).toContainText('大于零');
  await expect(amount).toHaveValue('10-20');
  await amount.fill('100-20');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(1);
  await expect(page.locator('.entry-row')).toContainText('HKD 80.00');
});

test('calculator does not bypass refund limits', async ({ page }) => {
  const amount = await openEntry(page);
  await amount.fill('18+12.5');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.locator('.entry-row').click();
  await page.getByRole('button', { name: '退款', exact: true }).click();
  const refund = page.getByRole('dialog', { name: '记录退款' });
  await expect(refund.getByLabel('记账币种')).toBeDisabled();
  await amount.fill('20+20');
  await refund.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('超过剩余可退金额');
  await expect(amount).toHaveValue('20+20');
  await amount.fill('20-10');
  await refund.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(refund).not.toBeVisible();
  await expect(page.getByLabel('CNY收支摘要')).toContainText('20.50');
});
