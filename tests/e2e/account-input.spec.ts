import { test, expect } from '@playwright/test';

test('registration waits for an input tap and retains typing through keyboard viewport changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册账号', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '注册账号', exact: true });
  const code = page.getByLabel('创建码', { exact: true });
  // A delayed input focus on iOS can select the field without opening its keyboard.
  await expect(dialog).toBeFocused();
  await expect(code).not.toBeFocused();
  expect(await dialog.evaluate((el) => el.parentElement?.parentElement === document.body)).toBe(
    true,
  );
  expect(
    await code.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await code.click();
  await page.keyboard.type('test-creation');
  await expect(code).toHaveValue('test-creation');
  await expect(code).toBeFocused();
  // Model the visual viewport moving/resizing independently of the layout viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 360 });
    Object.defineProperty(window.visualViewport, 'offsetTop', {
      configurable: true,
      get: () => 65,
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
    window.visualViewport!.dispatchEvent(new Event('scroll'));
  });
  await code.scrollIntoViewIfNeeded();
  await page.keyboard.type('-123');
  await expect(code).toHaveValue('test-creation-123');
  await expect(code).toBeFocused();
  const overlay = await dialog.locator('..').boundingBox();
  expect(overlay?.y).toBe(65);
  expect(overlay?.height).toBe(360);
  const field = await code.boundingBox();
  expect(field!.y).toBeGreaterThanOrEqual(overlay!.y);
  expect(field!.y + field!.height).toBeLessThanOrEqual(overlay!.y + overlay!.height);
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as Record<string, unknown>).height;
    delete (window.visualViewport as unknown as Record<string, unknown>).offsetTop;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '开启我的账本', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: '创建同步空间', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建同步空间', exact: true })).toBeFocused();
  await code.click();
  await page.keyboard.type('second-code');
  await expect(code).toHaveValue('second-code');
});
