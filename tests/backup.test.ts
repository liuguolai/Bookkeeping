import { describe, it, expect } from 'vitest';
import { emptyState, uid, validateState } from '../src/model';
import { createBook, saveEntry, saveBudget, deleteEntry } from '../src/domain';
import { encryptBackup, decryptBackup, restoreBackup, exportCsv, snapshot } from '../src/backup';
function data() {
  const s = emptyState();
  const b = createBook(s, '旅行', 'HKD', 'Asia/Hong_Kong');
  const expense = saveEntry(s, {
    id: uid(),
    bookId: b.id,
    type: 'expense',
    currency: 'HKD',
    amount: '120.30',
    categoryId: s.categories[0].id,
    note: '=HYPERLINK("x")\n中文,备注',
    occurredAt: '2026-01-02T13:00',
  });
  saveEntry(s, {
    ...expense,
    id: uid(),
    type: 'refund',
    originalId: expense.id,
    amount: '20.30',
    occurredAt: '2026-02-03T09:00',
  });
  saveBudget(s, {
    bookId: b.id,
    currency: 'HKD',
    month: '2026-01',
    amount: 20000,
    categories: { [s.categories[0].id]: 10000 },
  });
  return { s, b, expense };
}
describe('portable encrypted backups', () => {
  it('round trips precision, time zone, budgets and refund links without exposing content', async () => {
    const { s, b } = data();
    const encrypted = await encryptBackup(s, [b.id], 'correct-horse-123');
    expect(encrypted).not.toContain('旅行');
    expect(encrypted).not.toContain('HYPERLINK');
    const preview = await decryptBackup(encrypted, 'correct-horse-123');
    const target = emptyState();
    restoreBackup(target, preview);
    expect(validateState(target).entries).toHaveLength(2);
    expect(target.entries[1].originalId).toBe(target.entries[0].id);
    expect(target.entries[0].id).not.toBe(s.entries[0].id);
    expect(target.entries[0]).toMatchObject({
      currency: 'HKD',
      amount: 12030,
      occurredAt: '2026-01-02T13:00',
    });
    expect(target.books[0].timezone).toBe('Asia/Hong_Kong');
    expect(target.budgets[0].categories[target.entries[0].categoryId]).toBe(10000);
  });
  it('rejects wrong password and tampering', async () => {
    const { s, b } = data();
    const text = await encryptBackup(s, [b.id], 'password-123');
    await expect(decryptBackup(text, 'incorrect')).rejects.toThrow('密码错误');
    const envelope = JSON.parse(text);
    envelope.ciphertext = 'AAAA' + envelope.ciphertext.slice(4);
    await expect(decryptBackup(JSON.stringify(envelope), 'password-123')).rejects.toThrow('损坏');
  });
  it('does not accept excessive KDF work from untrusted files', async () => {
    await expect(
      decryptBackup(
        JSON.stringify({ format: 'pocket-ledger', version: 1, iterations: 999999999 }),
        'password',
      ),
    ).rejects.toThrow('格式');
  });
  it('requires explicit duplicate restore and never overwrites existing data', async () => {
    const { s, b } = data();
    const p = await decryptBackup(await encryptBackup(s, [b.id], 'password-123'), 'password-123');
    restoreBackup(s, p);
    expect(s.books).toHaveLength(2);
    expect(() => restoreBackup(s, p)).toThrow('恢复过');
    restoreBackup(s, p, true);
    expect(s.books).toHaveLength(3);
    expect(new Set(s.entries.map((e) => e.id)).size).toBe(6);
  });
  it('omits deleted records and drafts, while including archived books', () => {
    const { s, b, expense } = data();
    deleteEntry(s, expense.id);
    b.archived = true;
    const copy = snapshot(s, [b.id]);
    expect(copy.entries).toHaveLength(0);
    expect(copy.books[0].archived).toBe(true);
  });
  it('escapes CSV text and includes a currency column', () => {
    const { s } = data();
    const csv = exportCsv(s, s.entries);
    expect(csv).toContain('"币种"');
    expect(csv).toContain('"HKD"');
    expect(csv).toContain('"120.30"');
    expect(csv).toContain('"\'=HYPERLINK(""x"")');
    expect(csv).toContain('中文,备注');
    expect(csv).toContain('"退款"');
  });
});
