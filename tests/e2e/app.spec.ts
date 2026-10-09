import { test, expect, type Page } from '@playwright/test';
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开启我的账本' }).click();
  await expect(page.getByRole('heading', { name: '让每一笔，都有迹可循。' })).toBeVisible();
}
async function add(page: Page, amount: string, currency = 'CNY', note = '测试消费') {
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: '记一笔', exact: true });
  await dialog.getByLabel('金额', { exact: true }).fill(amount);
  await dialog.getByLabel('记账币种').selectOption(currency);
  await dialog.getByRole('button', { name: '餐饮', exact: true }).click();
  await dialog.getByLabel('备注', { exact: true }).fill(note);
  await dialog.getByRole('button', { name: '保存记录' }).click();
  await expect(dialog).not.toBeVisible();
}
async function nav(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).click();
}
test('category note suggestions rank by frequency and fill editable notes', async ({ page }) => {
  await start(page);
  await add(page, '10', 'CNY', '午餐');
  await add(page, '12', 'CNY', '午餐');
  await add(page, '18', 'HKD', '咖啡');
  await page.reload();
  await nav(page, '记一笔');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  const suggestions = page.getByRole('group', { name: '常用备注' });
  await expect(suggestions.getByRole('button').first()).toHaveAccessibleName('使用备注：午餐');
  await expect(suggestions.getByRole('button').first()).toContainText('2 次');
  await suggestions.getByRole('button', { name: '使用备注：午餐', exact: true }).click();
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('午餐');
  await page.getByLabel('备注', { exact: true }).fill('午餐加菜');
  await page.getByRole('button', { name: '交通', exact: true }).click();
  await expect(suggestions).toHaveCount(0);
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('午餐加菜');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await suggestions.getByRole('button', { name: '使用备注：咖啡', exact: true }).click();
  await page.getByLabel('金额', { exact: true }).fill('22');
  await suggestions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('note-suggestions.png') });
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await nav(page, '记一笔');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await expect(suggestions.getByRole('button').first()).toHaveAccessibleName('使用备注：咖啡');
  await expect(suggestions.getByRole('button').first()).toContainText('2 次');
});
test('direct year and month selection filters records and returns to current month', async ({
  page,
}) => {
  await start(page);
  await add(page, '28.50');
  const current = await page.locator('.month-label').textContent();
  await page.getByRole('button', { name: '选择年月' }).click();
  const picker = page.getByRole('dialog', { name: '选择年月' });
  await picker.getByLabel('年份', { exact: true }).fill('2020');
  await picker.getByRole('button', { name: '2月', exact: true }).click();
  await expect(page.locator('.month-label')).toHaveText('2020年2月');
  await expect(page.locator('.entry-row')).toHaveCount(0);
  await page.getByRole('button', { name: '选择年月' }).click();
  await picker.getByLabel('年份', { exact: true }).fill('');
  await expect(picker.getByRole('button', { name: '2月', exact: true })).toBeDisabled();
  await picker.getByLabel('年份', { exact: true }).fill('2024');
  await page.screenshot({ path: test.info().outputPath('month-picker.png') });
  await picker.getByLabel('关闭弹窗').click();
  await expect(page.locator('.month-label')).toHaveText('2020年2月');
  await page.getByRole('button', { name: '选择年月' }).click();
  await picker.getByRole('button', { name: '回到本月' }).click();
  await expect(page.locator('.month-label')).toHaveText(current!);
  await expect(page.locator('.entry-row')).toHaveCount(1);
});

test('category icons can be created, edited and retained after reload', async ({ page }) => {
  await start(page);
  await nav(page, '设置');
  await page.getByRole('button', { name: /分类与支付方式/ }).click();
  const dialog = page.getByRole('dialog', { name: '分类与支付方式' });
  await dialog.getByRole('button', { name: '新增分类', exact: true }).click();
  await dialog.getByLabel('分类名称').fill('下午茶');
  await dialog.getByRole('button', { name: '咖啡图标' }).click();
  await page.screenshot({ path: test.info().outputPath('category-icons.png') });
  await dialog.getByRole('button', { name: '添加', exact: true }).click();
  const row = dialog.locator('.simple-row').filter({ hasText: '下午茶' });
  await expect(row.locator('[data-icon="coffee"]')).toBeVisible();
  await row.getByRole('button', { name: '编辑下午茶' }).click();
  await expect(dialog.getByRole('button', { name: '咖啡图标' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: '礼物图标' }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(row.locator('[data-icon="gift"]')).toBeVisible();
  await page.reload();
  await nav(page, '设置');
  await page.getByRole('button', { name: /分类与支付方式/ }).click();
  await expect(row.locator('[data-icon="gift"]')).toBeVisible();
  await dialog.getByRole('button', { name: '支付方式', exact: true }).click();
  await expect(dialog.getByRole('group', { name: '分类图标' })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test('repeat preserves an existing draft and continuous entry uses a fresh ID', async ({
  page,
}) => {
  await start(page);
  await add(page, '25', 'HKD', '通勤');
  await nav(page, '记一笔');
  await page.getByLabel('金额', { exact: true }).fill('88');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.locator('.entry-row').click();
  await page.getByRole('button', { name: '再记一笔', exact: true }).click();
  const repeat = page.getByRole('dialog', { name: '再记一笔' });
  await expect(repeat.getByLabel('金额', { exact: true })).toHaveValue('25.00');
  await expect(repeat.getByLabel('记账币种')).toHaveValue('HKD');
  await repeat.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.entry-row')).toHaveCount(2);
  await nav(page, '记一笔');
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('88');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '昨天', exact: true }).click();
  const date = await page.getByLabel('发生时间').inputValue();
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('发生时间')).toHaveValue(date);
  await page.getByLabel('金额', { exact: true }).fill('19');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  // Yesterday can belong to the previous month; inspect persisted entries instead of a monthly list.
  const count = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open('pocket-ledger-preview');
        request.onsuccess = () => {
          const r = request.result.transaction('vault').objectStore('vault').get('state');
          r.onsuccess = () => {
            resolve(r.result.entries.length);
            request.result.close();
          };
        };
      }),
  );
  expect(count).toBe(4);
});

test('overdue backup reminder opens encrypted backup without interrupting entry', async ({
  page,
}) => {
  await start(page);
  await add(page, '20');
  await page.clock.install({ time: new Date(Date.now() + 8 * 86400000) });
  await page.reload();
  await expect(page.locator('.backup-reminder')).toBeVisible();
  await page.getByRole('button', { name: '去备份', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导出与备份' })).toBeVisible();
});

test('pinned category ordering persists and back protects unfinished entries', async ({ page }) => {
  await start(page);
  await nav(page, '设置');
  await page.getByRole('button', { name: /分类与支付方式/ }).click();
  await page.getByLabel('置顶购物', { exact: true }).click();
  await page.getByLabel('置顶餐饮', { exact: true }).click();
  await page.getByLabel('下移餐饮', { exact: true }).click();
  await expect(page.locator('.category-management .simple-row').first()).toContainText('购物');
  await page.reload();
  await nav(page, '记一笔');
  await expect(page.locator('.category-pick').first()).toContainText('购物');
  await page.getByLabel('金额', { exact: true }).fill('32');
  await page.evaluate(() => document.dispatchEvent(new Event('ledger-back', { cancelable: true })));
  await expect(page.getByRole('dialog', { name: '离开这笔记录？' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('32');
  await page.screenshot({ path: test.info().outputPath('quick-entry.png') });
});
test('multi-currency records persist, search and refund correctly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  await add(page, '28.50', 'CNY', '午餐');
  await add(page, '100', 'HKD', '香港午餐');
  await expect(page.getByLabel('CNY收支摘要')).toContainText('28.50');
  await expect(page.getByLabel('HKD收支摘要')).toContainText('100.00');
  await page.reload();
  await expect(page.getByLabel('CNY收支摘要')).toContainText('28.50');
  await page.getByLabel('搜索备注').fill('香港');
  await expect(page.locator('.entry-row')).toHaveCount(1);
  await page.locator('.entry-row').click();
  await page.getByRole('button', { name: '退款', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '记录退款' });
  await expect(dialog.getByLabel('记账币种')).toBeDisabled();
  await dialog.getByLabel('金额', { exact: true }).fill('20');
  await dialog.getByRole('button', { name: '保存记录' }).click();
  await page.getByLabel('搜索备注').fill('');
  await expect(page.getByLabel('HKD收支摘要')).toContainText('80.00');
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('records.png'), fullPage: true });
});
test('budget independence, deletion and recovery', async ({ page }) => {
  await start(page);
  await add(page, '80');
  await nav(page, '预算');
  await page.getByRole('button', { name: '设置本月预算' }).click();
  await page.getByLabel('本月总预算').fill('100');
  await page.getByRole('button', { name: '保存预算', exact: true }).click();
  await expect(page.locator('.budget-ring')).toContainText('80%');
  await page.getByLabel('统计预算币种').selectOption('HKD');
  await expect(page.locator('.budget-copy')).toContainText('还没有设置 HKD 预算');
  await nav(page, '明细');
  await page.locator('.entry-row').click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(0);
  await nav(page, '设置');
  await page.getByRole('button', { name: /回收站/ }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByText('没有已删除记录')).toBeVisible();
  await page.getByLabel('关闭弹窗').click();
  await nav(page, '明细');
  await expect(page.locator('.entry-row')).toHaveCount(1);
});
test('encrypted export and restore preview create an independent copy', async ({ page }) => {
  await start(page);
  await add(page, '1200', 'JPY', '日本旅行');
  await nav(page, '设置');
  await page.getByRole('button', { name: /导出、备份与恢复/ }).click();
  await page.getByLabel('备份密码', { exact: true }).fill('travel-password');
  await page.getByLabel('确认密码').fill('travel-password');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '生成加密备份' }).click();
  const download = await downloadPromise;
  const filePath = test.info().outputPath('test.pocket');
  await download.saveAs(filePath);
  await page.getByRole('button', { name: '恢复备份', exact: true }).click();
  await page.getByLabel('选择备份文件').setInputFiles(filePath);
  await page.getByLabel('恢复密码').fill('travel-password');
  await page.getByRole('button', { name: '校验并预览' }).click();
  await expect(page.getByText('备份校验通过')).toBeVisible();
  await page.getByRole('button', { name: '确认恢复为新账本' }).click();
  await expect(page.locator('.book-switch')).toContainText('副本');
});
test('no outbound requests, JPY precision validation, and no narrow-screen overflow', async ({
  page,
  context,
}) => {
  const external: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://127.0.0.1:4173') && !req.url().startsWith('data:'))
      external.push(req.url());
  });
  await start(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: '记一笔', exact: true });
  await dialog.getByLabel('记账币种').selectOption('JPY');
  await dialog.getByLabel('金额', { exact: true }).fill('1.50');
  await dialog.getByRole('button', { name: '餐饮', exact: true }).click();
  await dialog.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.toast[role=status]')).toContainText('整数');
  await dialog.getByLabel('金额', { exact: true }).fill('150');
  await dialog.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.entry-row')).toHaveCount(1);
  expect(external).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
test('unfinished new entries survive reload as drafts and currency search recognizes RMB', async ({
  page,
}) => {
  await start(page);
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  await page.getByLabel('金额', { exact: true }).fill('45.60');
  await page.getByLabel('备注', { exact: true }).fill('下班买菜');
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('pocket-ledger-preview');
            open.onsuccess = () => {
              const r = open.result.transaction('vault').objectStore('vault').get('state');
              r.onsuccess = () => resolve(r.result.drafts.length);
              r.onerror = () => reject(r.error);
            };
          }),
      ),
    )
    .toBe(1);
  await page.reload();
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('45.60');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('下班买菜');
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByRole('button', { name: '保存记录' }).click();
  await page.locator('.book-switch').click();
  await page.getByLabel('设置日常账本').click();
  await page.getByLabel('搜索币种').fill('RMB');
  await expect(page.locator('.currency-checks')).toContainText('CNY');
  await expect(page.locator('.currency-checks label')).toHaveCount(1);
});
