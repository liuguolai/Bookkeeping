import { test, expect, type Page } from '@playwright/test';
async function state(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('pocket-ledger-preview', 1);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<any>((resolve) => {
      const r = db.transaction('vault').objectStore('vault').get('state');
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
    });
  });
}
async function templates(page: Page) {
  await page.getByRole('button', { name: '常用模板', exact: true }).click();
}
async function create(page: Page) {
  await templates(page);
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByLabel('模板名称').fill('早餐');
  await page.getByLabel('模板金额').fill('10+2.3');
  await page.getByLabel('模板分类').selectOption({ label: '餐饮' });
  await page.getByLabel('模板支付方式').selectOption({ label: '微信' });
  await page.getByLabel('模板备注').fill('模板早餐');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(page.locator('.template-card')).toContainText('12.30');
}
async function backup(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: /导出、备份与恢复/ }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开启我的账本' }).click();
});
test('template CRUD and explicit entry save preserve an existing draft', async ({ page }) => {
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  await page.getByLabel('金额', { exact: true }).fill('88');
  await page.getByLabel('备注', { exact: true }).fill('保留草稿');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const before = (await state(page)).drafts;
  await create(page);
  expect((await state(page)).entries).toHaveLength(0);
  await page.getByRole('button', { name: '使用模板', exact: true }).click();
  await expect(page.getByLabel('金额', { exact: true })).toBeFocused();
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('12.30');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  expect((await state(page)).drafts).toEqual(before);
  expect((await state(page)).entries[0].amount).toBe(1230);
  await templates(page);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('模板金额').fill('');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(page.locator('.template-card')).toContainText('每次填写金额');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '删除模板', exact: true }).click();
  expect((await state(page)).templates).toHaveLength(0);
  expect((await state(page)).entries).toHaveLength(1);
});
test('encrypted file download and reimport retain templates as new books', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await backup(page);
  await page.getByLabel('备份密码', { exact: true }).fill('test-password');
  await page.getByLabel('确认密码').fill('test-password');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '生成加密备份' }).click();
  const download = await downloading,
    path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole('button', { name: '恢复备份', exact: true }).click();
  await page.getByLabel('选择备份文件').setInputFiles(path!);
  await page.getByLabel('恢复密码').fill('test-password');
  await page.getByRole('button', { name: '校验并预览' }).click();
  await expect(page.locator('.backup-preview')).toContainText('1 个模板');
  await page.getByRole('button', { name: '确认恢复为新账本' }).click();
  await expect.poll(async () => (await state(page)).books.length).toBe(2);
  const saved = await state(page);
  expect(saved.templates).toHaveLength(2);
  expect(saved.templates[0].bookId).not.toBe(saved.templates[1].bookId);
});
test('local restore confirms scope, preserves current state, and can undo', async ({ page }) => {
  await backup(page);
  await page.getByRole('button', { name: '本机保护', exact: true }).click();
  await page.getByRole('button', { name: '创建本机保护副本' }).click();
  await expect(page.locator('.template-card')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '明细', exact: true }).filter({ visible: true }).click();
  await create(page);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await backup(page);
  await page.getByRole('button', { name: '本机保护', exact: true }).click();
  await page.getByRole('button', { name: '查看恢复选项' }).click();
  expect((await state(page)).templates).toHaveLength(1);
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: '确认还原全部账本' }).click(),
  ]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await state(page)).templates.length).toBe(0);
  await backup(page);
  await page.getByRole('button', { name: '本机保护', exact: true }).click();
  await page
    .locator('.template-card')
    .filter({ hasText: '恢复前自动留存' })
    .getByRole('button', { name: '查看恢复选项' })
    .click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: '确认还原全部账本' }).click(),
  ]);
  await expect.poll(async () => (await state(page)).templates.length).toBe(1);
});
test('unreadable current data exposes recovery without clearing the vault', async ({ page }) => {
  await backup(page);
  await page.getByRole('button', { name: '本机保护', exact: true }).click();
  await page.getByRole('button', { name: '创建本机保护副本' }).click();
  await expect(page.locator('.template-card')).toHaveCount(1);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('pocket-ledger-preview', 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const t = db.transaction('vault', 'readwrite');
      t.objectStore('vault').put({ damaged: true }, 'state');
      t.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '暂时无法打开账本' })).toBeVisible();
  await page.getByRole('button', { name: '查看恢复选项' }).click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: '确认还原全部账本' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: '暂时无法打开账本' })).toHaveCount(0);
  await expect.poll(async () => (await state(page)).books.length).toBe(1);
});
