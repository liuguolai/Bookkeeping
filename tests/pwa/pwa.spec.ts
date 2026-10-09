import { test, expect, type Page } from '@playwright/test';
async function ready(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}
async function nav(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).click();
}
async function start(page: Page) {
  await ready(page);
  await nav(page, '开启我的账本');
}
async function add(page: Page, amount: string, note: string) {
  await nav(page, '记一笔');
  await page.getByLabel('金额', { exact: true }).fill(amount);
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByLabel('备注', { exact: true }).fill(note);
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test.beforeEach(async ({ request }) => {
  await request.post('/__test__/release?v=a');
});

test('initial incomplete download stays unready and recovers after a complete release', async ({
  page,
  request,
}) => {
  await request.post('/__test__/release?v=broken');
  await page.goto('/');
  await nav(page, '开启我的账本');
  await nav(page, '设置');
  await expect(page.getByText(/离线文件准备失败/)).toBeVisible();
  await expect(page.getByText('离线尚未就绪', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更新并重新打开' })).toHaveCount(0);
  await request.post('/__test__/release?v=a');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.getByText('离线已就绪', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更新并重新打开' })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addStyleTag({ content: 'html{font-size:20px}' });
  await page.getByRole('region', { name: '安装与离线使用' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/pwa-019-settings-narrow.png' });
});

test('storage recovery screen can update the app without deleting damaged data', async ({
  page,
  request,
}) => {
  await start(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('pocket-ledger-preview');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('vault', 'readwrite');
      tx.objectStore('vault').put({ damaged: true }, 'state');
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '暂时无法打开账本' })).toBeVisible();
  await request.post('/__test__/release?v=b');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '更新并重新打开', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'b');
  expect(
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('pocket-ledger-preview');
          request.onsuccess = () => {
            const db = request.result,
              read = db.transaction('vault').objectStore('vault').get('state');
            read.onsuccess = () => {
              resolve(read.result);
              db.close();
            };
          };
        }),
    ),
  ).toEqual({ damaged: true });
});

test('install manifest, complete cache, icons and subdirectory deployment', async ({
  page,
  request,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4175/') && !request.url().startsWith('data:'))
      external.push(request.url());
  });
  await ready(page, '/ledger/');
  const manifestURL = await page
    .locator('link[rel=manifest]')
    .evaluate((el: HTMLLinkElement) => el.href);
  expect(manifestURL).toContain('/ledger/manifest.webmanifest');
  const manifest = await (await request.get(manifestURL)).json();
  expect(manifest).toMatchObject({ start_url: './', scope: './', display: 'standalone' });
  for (const icon of manifest.icons) {
    const dimensions = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return `${img.naturalWidth}x${img.naturalHeight}`;
    }, `/ledger/${icon.src}`);
    expect(dimensions).toBe(icon.sizes);
  }
  const session = await page.context().newCDPSession(page);
  const installability = await session.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '离线已就绪' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      fetch('/network-probe').then(
        () => false,
        () => true,
      ),
    ),
  ).toBe(true);
  await expect(page.getByRole('button', { name: '开启我的账本' })).toBeVisible();
  expect(external).toEqual([]);
});

test('offline cold reopen, encrypted backup download and restore', async ({ page, context }) => {
  await start(page);
  await add(page, '28.50', '离线前记录');
  await context.setOffline(true);
  await page.close();
  const offline = await context.newPage();
  await offline.goto('/');
  await expect(offline.locator('.entry-row')).toContainText('离线前记录');
  await add(offline, '12', '离线新增');
  await nav(offline, '设置');
  await offline.getByRole('button', { name: /导出、备份与恢复/ }).click();
  await offline.getByLabel('备份密码', { exact: true }).fill('Offline-1234');
  await offline.getByLabel('确认密码', { exact: true }).fill('Offline-1234');
  const downloadEvent = offline.waitForEvent('download');
  await offline.getByRole('button', { name: '生成加密备份', exact: true }).click();
  const download = await downloadEvent;
  const path = test.info().outputPath('offline-backup.pocket');
  await download.saveAs(path);
  await expect(offline.getByRole('link', { name: '下载文件', exact: true })).toBeVisible();
  await offline.getByRole('button', { name: '恢复备份', exact: true }).click();
  await offline.locator('input[type=file]').setInputFiles(path);
  await offline.getByLabel('恢复密码', { exact: true }).fill('Offline-1234');
  await offline.getByRole('button', { name: '校验并预览' }).click();
  await offline.getByRole('button', { name: '确认恢复为新账本' }).click();
  await expect(offline.getByRole('dialog', { name: '导出与备份' })).toHaveCount(0);
  await nav(offline, '明细');
  await expect(offline.locator('.entry-row')).toHaveCount(2);
  await offline.reload();
  await expect(offline.locator('.entry-row')).toHaveCount(2);
});

test('update waits for editing and other tabs, then retains records and drafts', async ({
  page,
  context,
  request,
}) => {
  await start(page);
  await add(page, '30', '更新保留');
  const second = await context.newPage();
  await second.goto('/');
  await nav(page, '记一笔');
  await page.getByLabel('金额', { exact: true }).fill('66');
  await request.post('/__test__/release?v=b');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  const update = page.getByRole('button', { name: '更新并重新打开', exact: true });
  await expect(update).toBeAttached();
  // The modal normally prevents this click; invoke the handler to also check the defensive guard.
  await update.evaluate((button: HTMLButtonElement) => button.click());
  await expect(
    page.getByText('请先保存并关闭正在编辑的窗口，再更新。', { exact: true }),
  ).toBeAttached();
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('66');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await update.click();
  await expect(
    page.getByText('请先关闭其他记账标签页或桌面窗口，再更新。', { exact: true }),
  ).toBeVisible();
  await second.close();
  await update.click();
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'b');
  await expect(page.locator('.entry-row')).toContainText('更新保留');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.entry-row')).toContainText('更新保留');
  await nav(page, '记一笔');
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('66');
});

test('failed release preserves previous offline shell and data', async ({
  page,
  context,
  request,
}) => {
  await start(page);
  await add(page, '9', '失败更新仍保留');
  await request.post('/__test__/release?v=broken');
  const redundant = page.evaluate(async () => {
    const reg = (await navigator.serviceWorker.getRegistration())!;
    const failure = new Promise<void>((resolve) =>
      reg.addEventListener(
        'updatefound',
        () => {
          const worker = reg.installing!;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'redundant') resolve();
          });
        },
        { once: true },
      ),
    );
    await reg.update();
    await failure;
  });
  await redundant;
  await expect(page.getByRole('button', { name: '更新并重新打开' })).toHaveCount(0);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'a');
  await expect(page.locator('.entry-row')).toContainText('失败更新仍保留');
  expect(
    await page.evaluate(async () => (await caches.keys()).some((key) => key.endsWith('-broken'))),
  ).toBe(false);
});

test('storage denial and cancelled file sharing retain download fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', {
      value: async () => {
        throw new DOMException('cancel', 'AbortError');
      },
    });
  });
  await start(page);
  await nav(page, '设置');
  await page.getByRole('button', { name: '申请持久存储' }).click();
  await expect(page.getByText(/浏览器暂未授予持久存储/)).toBeVisible();
  await page.getByRole('button', { name: '安装与使用说明' }).click();
  await expect(page.getByRole('dialog')).toContainText('Safari');
  await page.getByLabel('关闭弹窗').click();
  await page.getByRole('button', { name: /导出、备份与恢复/ }).click();
  await page.getByLabel('备份密码', { exact: true }).fill('Sharing-1234');
  await page.getByLabel('确认密码', { exact: true }).fill('Sharing-1234');
  await page.getByRole('button', { name: '生成加密备份', exact: true }).click();
  await page.getByRole('button', { name: '分享或存储到文件' }).click();
  await expect(page.getByText('已取消分享，可再次分享或下载文件。')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载文件', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.pocket$/);
  await page.screenshot({ path: 'docs/screenshots/pwa-019-backup.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
