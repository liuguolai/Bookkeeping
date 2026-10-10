import { test, expect, type Page } from '@playwright/test';
async function nav(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).click();
}
async function add(page: Page, note: string, amount = '12.30') {
  await nav(page, '明细');
  await nav(page, '记一笔');
  await page.getByLabel('金额', { exact: true }).fill(amount);
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByLabel('备注', { exact: true }).fill(note);
  await nav(page, '保存记录');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function sync(page: Page) {
  await nav(page, '设置');
  await nav(page, '立即同步');
  await expect(page.getByRole('region', { name: '云同步' }).getByRole('status')).toHaveText(
    '已同步',
  );
}
async function create(page: Page) {
  await page.goto('/');
  await nav(page, '开启我的账本');
  await nav(page, '设置');
  await nav(page, '创建同步空间');
  const key = await page.getByLabel('同步密钥', { exact: true }).inputValue();
  await page.getByLabel('创建码', { exact: true }).fill('local-development-only');
  await page.getByText('我已安全保存同步密钥', { exact: true }).click();
  await nav(page, '连接并开启同步');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '云同步' }).getByRole('status')).toHaveText(
    '已同步',
  );
  return key;
}
async function join(page: Page, key: string) {
  await page.goto('http://127.0.0.1:4176/');
  await nav(page, '使用已有密钥连接');
  await page.getByLabel('同步密钥', { exact: true }).fill(key);
  await nav(page, '连接并开启同步');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }),
  ).toBeVisible();
}

test('password account: bind existing space, login on fresh device, change and recover without duplicates', async ({
  page,
  browser,
}) => {
  const key = await create(page);
  await add(page, '账号登录恢复的账目', '66.88');
  await sync(page);
  const username = `user_${Date.now()}`;
  const password = 'Test123!';
  const changed = 'Next456!';
  const recovered = 'Back789!';
  const fillNew = async (target: Page, value: string) => {
    await target.getByLabel('新密码', { exact: true }).fill(value);
    await target.getByLabel('确认新密码', { exact: true }).fill(value);
    await target.getByText('我已保存恢复密钥并了解上述说明', { exact: true }).click();
  };
  await nav(page, '账号与密码');
  await page.getByLabel('账号名', { exact: true }).fill(username);
  await fillNew(page, password);
  await nav(page, '绑定账号');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const second = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 320, height: 740 },
    baseURL: 'http://127.0.0.1:4176',
  });
  try {
    const pc = await second.newPage();
    const login = async (value: string) => {
      await nav(pc, '账号登录');
      await pc.getByLabel('账号名', { exact: true }).fill(username.toUpperCase());
      await pc.getByLabel('密码', { exact: true }).fill(value);
      await nav(pc, '登录并同步');
    };
    await pc.goto('/');
    await login('A wrong password for browser testing');
    await expect(pc.getByRole('alert')).toContainText('账号或密码不正确');
    await expect(pc.getByRole('heading', { name: '已有云端账本？' })).toBeVisible();
    await pc.getByLabel('密码', { exact: true }).fill(password);
    await nav(pc, '登录并同步');
    await expect(pc.getByRole('dialog')).toHaveCount(0);
    await expect(pc.locator('.entry-row')).toContainText('账号登录恢复的账目');
    await nav(pc, '设置');
    await expect(pc.getByText('最近成功同步：1 个账本 · 1 笔记录（不含回收站）')).toBeVisible();
    await nav(pc, '账号与密码');
    await expect(pc.getByLabel('账号名')).toHaveValue(username);
    await fillNew(pc, changed);
    expect(await pc.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pc
      .getByRole('dialog')
      .screenshot({ path: test.info().outputPath('account-password-mobile.png') });
    await nav(pc, '更新密码');
    await expect(pc.getByRole('dialog')).toHaveCount(0);
    // Existing key-based device stays connected and can still upload.
    await add(page, '改密码后原设备新增');
    await sync(page);
    await nav(pc, '断开同步');
    await pc.getByRole('dialog').getByRole('button', { name: '断开同步', exact: true }).click();
    await login(password);
    await expect(pc.getByRole('alert')).toContainText('账号或密码不正确');
    await pc.getByLabel('密码', { exact: true }).fill(changed);
    await nav(pc, '登录并同步');
    await expect(pc.getByRole('dialog')).toHaveCount(0);
    await nav(pc, '明细');
    await expect(pc.locator('.entry-row')).toHaveCount(2);
    await nav(pc, '设置');
    await nav(pc, '断开同步');
    await pc.getByRole('dialog').getByRole('button', { name: '断开同步', exact: true }).click();
    await nav(pc, '账号登录');
    await nav(pc, '忘记账号或密码？用恢复密钥找回');
    await pc.getByLabel('恢复密钥', { exact: true }).fill(key);
    await fillNew(pc, recovered);
    await nav(pc, '重设密码并连接');
    await expect(pc.getByRole('dialog')).toHaveCount(0);
    await expect(pc.getByText('最近成功同步：1 个账本 · 2 笔记录（不含回收站）')).toBeVisible();
  } finally {
    await second.close();
  }
});
test('account login and recovery cannot silently switch a device to another space', async ({
  page,
  browser,
}) => {
  const key = await create(page);
  const username = `guard_${Date.now()}`;
  const password = 'A unique account isolation password';
  await nav(page, '账号与密码');
  await page.getByLabel('账号名').fill(username);
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByLabel('确认新密码', { exact: true }).fill(password);
  await page.getByText('我已保存恢复密钥并了解上述说明', { exact: true }).click();
  await nav(page, '绑定账号');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const second = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:4176' });
  try {
    const pc = await second.newPage();
    await create(pc);
    await add(pc, '另一个空间的本地记录');
    await sync(pc);
    await nav(pc, '断开同步');
    await pc.getByRole('dialog').getByRole('button', { name: '断开同步', exact: true }).click();
    await nav(pc, '账号登录');
    await pc.getByLabel('账号名').fill(username);
    await pc.getByLabel('密码', { exact: true }).fill(password);
    await nav(pc, '登录并同步');
    await expect(pc.getByRole('alert')).toContainText('不会自动切换或混合账号');
    await nav(pc, '忘记账号或密码？用恢复密钥找回');
    await pc.getByLabel('恢复密钥', { exact: true }).fill(key);
    await pc.getByLabel('新密码', { exact: true }).fill('A password that must not be set');
    await pc.getByLabel('确认新密码', { exact: true }).fill('A password that must not be set');
    await pc.getByText('我已保存恢复密钥并了解上述说明', { exact: true }).click();
    await nav(pc, '重设密码并连接');
    await expect(pc.getByRole('alert')).toContainText('不会自动切换或混合账号');
    await pc.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await nav(pc, '明细');
    await expect(pc.locator('.entry-row')).toContainText('另一个空间的本地记录');
    const cached = await pc.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
      return urls;
    });
    expect(cached.some((url) => url.includes('/api/'))).toBe(false);
  } finally {
    await second.close();
  }
});

test('real Worker + D1: encrypted account, two devices, offline/reload, deletion and no API cache', async ({
  page,
  context,
  browser,
}) => {
  const key = await create(page);
  await add(page, '手机消费');
  await sync(page);
  const second = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
    baseURL: 'http://127.0.0.1:4176',
  });
  const pc = await second.newPage();
  await join(pc, key);
  await expect(pc.locator('.entry-row')).toContainText('手机消费');
  await context.setOffline(true);
  await add(page, '手机离线新增', '18.88');
  await page.reload();
  await expect(page.locator('.entry-row')).toHaveCount(2);
  await add(pc, '电脑新增', '8.80');
  await sync(pc);
  await context.setOffline(false);
  await sync(page);
  await sync(pc);
  await nav(pc, '明细');
  await expect(pc.locator('.entry-row')).toHaveCount(3);
  await nav(page, '明细');
  await expect(page.locator('.entry-row')).toHaveCount(3);
  await page.locator('.entry-row').filter({ hasText: '手机消费' }).click();
  await page
    .getByRole('dialog', { name: '记录详情' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '删除这笔记录？' })
    .getByRole('button', { name: '删除记录', exact: true })
    .click();
  await sync(page);
  await sync(pc);
  await nav(pc, '明细');
  await expect(pc.locator('.entry-row')).toHaveCount(2);
  const cached = await page.evaluate(async () => {
    const keys: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys()) keys.push(request.url);
    return keys;
  });
  expect(cached.some((url) => url.includes('/api/'))).toBe(false);
  const unauth = await pc.request.get('/api/sync/v1/vault');
  expect(unauth.status()).toBe(401);
  await page.setViewportSize({ width: 320, height: 740 });
  await nav(page, '设置');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole('region', { name: '云同步' })
    .screenshot({ path: test.info().outputPath('cloud-sync-mobile.png') });
  await second.close();
});
test('conflict selection preserves both versions until confirmation and resolves through the UI', async ({
  page,
  context,
  browser,
}) => {
  const key = await create(page);
  await add(page, '编辑目标');
  await sync(page);
  const second = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
  });
  const other = await second.newPage();
  await join(other, key);
  const edit = async (target: Page, note: string) => {
    await nav(target, '明细');
    await target.locator('.entry-row').first().click();
    await nav(target, '编辑');
    await target.getByLabel('备注', { exact: true }).fill(note);
    await nav(target, '保存记录');
  };
  await context.setOffline(true);
  await second.setOffline(true);
  await edit(page, '手机修改');
  await edit(other, '电脑修改');
  await second.setOffline(false);
  await sync(other);
  await context.setOffline(false);
  await nav(page, '设置');
  await nav(page, '立即同步');
  await expect(page.getByText('有 1 项修改需要确认')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认选择并同步' })).toBeDisabled();
  await page.getByText('保留云端版本', { exact: true }).click();
  await nav(page, '确认选择并同步');
  await expect(page.getByRole('region', { name: '云同步' }).getByRole('status')).toHaveText(
    '已同步',
  );
  await nav(page, '明细');
  await expect(page.locator('.entry-row')).toContainText('电脑修改');
  await second.close();
});
test('bad create code does not connect, key must be saved, disconnect retains local records', async ({
  page,
}) => {
  await page.goto('/');
  await nav(page, '开启我的账本');
  await add(page, '仅本机');
  await nav(page, '设置');
  await nav(page, '创建同步空间');
  await expect(page.getByRole('button', { name: '连接并开启同步' })).toBeDisabled();
  await page.getByText('我已安全保存同步密钥', { exact: true }).click();
  await page.getByLabel('创建码', { exact: true }).fill('wrong');
  await nav(page, '连接并开启同步');
  await expect(page.getByRole('alert')).toContainText('创建码不正确');
  await page.getByLabel('创建码', { exact: true }).fill('local-development-only');
  await nav(page, '连接并开启同步');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, '断开同步');
  await page.getByRole('dialog').getByRole('button', { name: '断开同步', exact: true }).click();
  await expect(page.getByRole('region', { name: '云同步' }).getByRole('status')).toHaveText(
    '已断开，账目保留在本机',
  );
  await nav(page, '明细');
  await expect(page.locator('.entry-row')).toContainText('仅本机');
});

test('same-name empty book stays intact and synced records are discoverable across months', async ({
  page,
  browser,
}) => {
  const key = await create(page);
  await add(page, '旧月份的同步记录', '520');
  await nav(page, '明细');
  await page.locator('.entry-row').click();
  await nav(page, '编辑');
  await page.getByLabel('发生时间', { exact: true }).fill('2025-01-15T12:00');
  await nav(page, '保存记录');
  await sync(page);
  const second = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 320, height: 740 },
    baseURL: 'http://127.0.0.1:4176',
  });
  try {
    const pc = await second.newPage();
    await pc.goto('/');
    await expect(pc.getByRole('heading', { name: '已有云端账本？' })).toBeVisible();
    await expect(pc.getByRole('button', { name: '创建同步空间', exact: true })).toHaveCount(0);
    await nav(pc, '开启我的账本');
    await nav(pc, '设置');
    await nav(pc, '使用已有密钥连接');
    await pc.getByLabel('同步密钥', { exact: true }).fill(key);
    await nav(pc, '连接并开启同步');
    await expect(pc.getByRole('dialog')).toHaveCount(0);
    await expect(pc.getByText('最近成功同步：2 个账本 · 1 笔记录（不含回收站）')).toBeVisible();
    await expect(pc.getByText(/当前“日常账本”没有记录/)).toBeVisible();
    await pc
      .getByRole('region', { name: '云同步' })
      .screenshot({ path: test.info().outputPath('sync-summary-mobile.png') });
    await nav(pc, '明细');
    await nav(pc, '查看有记录的账本');
    await expect(pc.getByText(/发现同名账本/)).toBeVisible();
    await expect(pc.locator('.book-current')).toHaveCount(1);
    await expect(pc.locator('.book-main')).toHaveCount(2);
    expect(await pc.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pc
      .getByRole('dialog')
      .screenshot({ path: test.info().outputPath('same-name-books-mobile.png') });
    await pc.getByRole('button', { name: /日常账本.*1 笔记录/ }).click();
    await expect(pc.locator('.entry-row')).toContainText('旧月份的同步记录');
    await expect(pc.locator('.entry-row')).toContainText('520.00');
    await nav(pc, '设置');
    await nav(pc, '查看全部账本');
    await expect(pc.locator('.book-main')).toHaveCount(2);
  } finally {
    await second.close();
  }
});

test('fresh device restores existing books without creating a default duplicate', async ({
  page,
  browser,
}) => {
  const key = await create(page);
  await add(page, '直接连接已有账本');
  await sync(page);
  const second = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:4176',
  });
  try {
    const pc = await second.newPage();
    await pc.goto('/');
    await expect(pc.getByRole('heading', { name: '已有云端账本？' })).toBeVisible();
    await pc.screenshot({ path: test.info().outputPath('welcome-mobile.png'), fullPage: true });
    await join(pc, key);
    await expect(pc.locator('.entry-row')).toContainText('直接连接已有账本');
    await nav(pc, '设置');
    await expect(pc.getByText('最近成功同步：1 个账本 · 1 笔记录（不含回收站）')).toBeVisible();
    await nav(pc, '查看全部账本');
    await expect(pc.locator('.book-main')).toHaveCount(1);
  } finally {
    await second.close();
  }
});
