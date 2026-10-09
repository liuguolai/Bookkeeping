import { expect, it } from 'vitest';
import { emptyState, uid, validateState } from '../src/model';
import { createBook, purgeExpired } from '../src/domain';
import { saveTemplate } from '../src/templates';
import { encryptBackup, decryptBackup, restoreBackup } from '../src/backup';
function fixture() {
  const s = emptyState(),
    b = createBook(s, '日常', 'CNY');
  const t = {
    id: uid(),
    bookId: b.id,
    name: '早餐',
    type: 'expense' as const,
    currency: 'CNY' as const,
    amount: 1230,
    categoryId: s.categories[0].id,
    paymentId: s.payments[0].id,
    note: '豆浆',
  };
  return { s, b, t };
}
it('validates template ownership, active choices, duplicates, limits and precision', () => {
  const { s, b, t } = fixture();
  saveTemplate(s, t);
  expect(() => saveTemplate(s, { ...t, id: uid() })).toThrow('同名');
  expect(() => saveTemplate(s, { ...t, amount: 0 }, true)).toThrow();
  expect(() => saveTemplate(s, { ...t, amount: 1.5 }, true)).toThrow();
  const other = createBook(s, '旅行', 'JPY');
  expect(() => saveTemplate(s, { ...t, id: uid(), bookId: other.id })).toThrow('分类');
  s.categories[0].active = false;
  expect(() => saveTemplate(s, t, true)).toThrow('分类');
  expect(validateState(s).templates).toHaveLength(1);
  s.categories[0].active = true;
  for (let i = 1; i < 20; i++)
    saveTemplate(s, { ...t, id: uid(), name: `模板${i}`, amount: undefined });
  expect(() => saveTemplate(s, { ...t, id: uid(), name: '超额' })).toThrow('20');
  b.archived = true;
  expect(() => saveTemplate(s, t, true)).toThrow('归档');
});
it('encrypts and restores templates with all IDs remapped and separate currencies retained', async () => {
  const { s, b, t } = fixture();
  saveTemplate(s, t);
  saveTemplate(s, { ...t, id: uid(), name: '日元早餐', currency: 'JPY', amount: 500 });
  const text = await encryptBackup(s, [b.id], 'test-password');
  expect(text).not.toContain('豆浆');
  const preview = await decryptBackup(text, 'test-password'),
    target = emptyState();
  restoreBackup(target, preview);
  expect(validateState(target).templates).toHaveLength(2);
  expect(target.templates[0]).toMatchObject({
    name: '早餐',
    amount: 1230,
    currency: 'CNY',
    bookId: target.books[0].id,
    categoryId: target.categories[0].id,
    paymentId: target.payments[0].id,
  });
  expect(target.templates[0].id).not.toBe(t.id);
  expect(target.templates[1].amount).toBe(500);
});
it('migrates old states, rejects future states, and purges templates with expired books', () => {
  const { s, b, t } = fixture();
  saveTemplate(s, t);
  expect(validateState({ ...s, version: 1, templates: undefined }).templates).toEqual([]);
  expect(() => validateState({ ...s, version: 3 })).toThrow();
  b.deletedAt = 1;
  purgeExpired(s);
  expect(s.templates).toEqual([]);
});

it('decrypts a legacy schema-1 backup created before templates existed', async () => {
  const { s } = fixture();
  const payload = { formatVersion: 1, createdAt: Date.now(), currencies: { CNY: 2 }, state: { ...s, version: 1, templates: undefined } };
  const encoder = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', encoder.encode('legacy-password'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('PocketLedger backup v1') }, key, encoder.encode(JSON.stringify(payload)));
  const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64');
  const file = JSON.stringify({ format: 'pocket-ledger', version: 1, algorithm: 'AES-GCM/PBKDF2-SHA256', iterations: 310000, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(cipher)) });
  const restored = await decryptBackup(file, 'legacy-password');
  expect(restored.state.version).toBe(2); expect(restored.state.templates).toEqual([]); expect(restored.state.books).toEqual(s.books);
});
