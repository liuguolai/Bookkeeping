import { test, expect, type Page } from '@playwright/test';

const language = (page: Page) => page.getByRole('combobox', { name: '语言 / Language' });
const nav = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();

async function noChineseInterface(page: Page) {
  const text = await page.locator('body').evaluate((body) => {
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('select, script, style').forEach((node) => node.remove());
    return clone.textContent ?? '';
  });
  expect(text).not.toMatch(/[\u3400-\u9fff]/);
}

test('English and traditional interfaces preserve entries, custom names and drafts across reloads', async ({
  page,
}) => {
  await page.goto('/');
  await language(page).selectOption('en');
  await expect(page).toHaveTitle('Pocket Ledger');
  await expect(page.getByLabel('Ledger name', { exact: true })).toHaveValue('Everyday ledger');
  await page.getByRole('button', { name: 'Start my ledger' }).click();
  await noChineseInterface(page);
  await nav(page, 'Add entry').click();
  await page.getByLabel('Amount', { exact: true }).fill('18+12.5');
  await page.getByRole('button', { name: 'Dining', exact: true }).click();
  await page.getByPlaceholder('Add a little detail to this entry').fill('咖啡 {0} Coffee');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.locator('.entry-row')).toContainText('30.50');
  await nav(page, 'Add entry').click();
  await page.getByLabel('Amount', { exact: true }).fill('100-');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await nav(page, 'Settings').click();
  await language(page).selectOption('zh-TW');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page).toHaveTitle('口袋帳本');
  await expect(
    page.getByText('資料與備份', { exact: true }).or(page.getByText('數據與備份', { exact: true })),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page.locator('.entry-row')).toContainText('咖啡 {0} Coffee');
  await expect(page.locator('.entry-row')).toContainText('Dining');
  await nav(page, '記一筆').click();
  await expect(page.getByLabel('金額', { exact: true })).toHaveValue('100-');
  await page.getByRole('button', { name: '計算結果', exact: true }).click();
  await expect(page.locator('#amount-calculation-hint')).toContainText('請補全算式');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await nav(page, '設置').click();
  await language(page).selectOption('zh-CN');
  await expect(page.getByText('数据与备份', { exact: true })).toBeVisible();
  await nav(page, '明细').click();
  await expect(page.locator('.entry-row')).toHaveCount(1);
  await expect(page.locator('.entry-row')).toContainText('30.50');
});

test.describe('system language and English layouts', () => {
  test.use({ locale: 'en-US' });
  test('follows the system initially and translates all major panels', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await expect(language(page)).toHaveValue('en');
    await page.getByRole('button', { name: 'Start my ledger' }).click();
    await nav(page, 'Statistics').click();
    await noChineseInterface(page);
    await expect(
      page.getByRole('heading', { name: 'Monthly comparison', exact: true }),
    ).toBeVisible();
    await nav(page, 'Budget').click();
    await noChineseInterface(page);
    await page.getByRole('button', { name: 'Set monthly budget' }).click();
    await expect(page.getByRole('button', { name: 'Save budget' })).toBeVisible();
    await noChineseInterface(page);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await nav(page, 'Settings').click();
    await noChineseInterface(page);
    await page.getByRole('button', { name: /Categories & payment methods/ }).click();
    await noChineseInterface(page);
    await page.getByRole('button', { name: 'Add category', exact: true }).click();
    await page.getByText('Choose a suggested category', { exact: true }).click();
    await noChineseInterface(page);
    await page.getByRole('button', { name: 'Choose suggested category Pets', exact: true }).click();
    await expect(page.getByLabel('Category name', { exact: true })).toHaveValue('Pets');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: /Export, backup & restore/ }).click();
    await noChineseInterface(page);
    await page.getByRole('button', { name: 'Local protection', exact: true }).click();
    await noChineseInterface(page);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Account sign-in', exact: true }).click();
    await noChineseInterface(page);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `.local/i18n-${testInfo.project.name}-settings.png`,
      fullPage: true,
    });
    await nav(page, 'Records').click();
    await nav(page, 'Add entry').click();
    await page.getByLabel('Amount', { exact: true }).fill('10-20');
    await page.getByRole('button', { name: 'Calculate result', exact: true }).click();
    await expect(page.locator('#amount-calculation-hint')).toContainText('greater than zero');
    await noChineseInterface(page);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `.local/i18n-${testInfo.project.name}-entry.png`,
      fullPage: false,
    });
  });
});

test.describe('traditional system language', () => {
  test.use({ locale: 'zh-HK' });
  test('selects traditional and stores new defaults in that language', async ({ page }) => {
    await page.goto('/');
    await expect(language(page)).toHaveValue('zh-TW');
    await expect(page.getByLabel('帳本名稱', { exact: true })).toHaveValue('日常帳本');
    await page.getByRole('button', { name: '開啟我的帳本' }).click();
    await nav(page, '記一筆').click();
    await expect(page.getByRole('button', { name: '餐飲', exact: true })).toBeVisible();
  });
});
