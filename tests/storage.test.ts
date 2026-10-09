import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserPersistence, Repository, type Persistence } from '../src/storage';
import { createBook, saveEntry, deleteEntry, restoreEntry } from '../src/domain';
import { type State, uid } from '../src/model';
describe('atomic persistence', () => {
  beforeEach(async () => {
    await new BrowserPersistence().destroy();
  });
  it('survives a new repository instance and serializes queued writes', async () => {
    const repo = new Repository(new BrowserPersistence());
    await repo.transaction((s) => createBook(s, '日常', 'CNY'));
    await Promise.all([
      repo.transaction((s) => {
        s.books[0].name = '改名';
      }),
      repo.transaction((s) => {
        s.books[0].currency = 'HKD';
      }),
    ]);
    const loaded = await new Repository(new BrowserPersistence()).load();
    expect(loaded.books[0]).toMatchObject({ name: '改名', currency: 'HKD' });
    expect(loaded.revision).toBe(3);
  });
  it('rejects stale compare-and-swap without overwriting the stored state', async () => {
    const p = new BrowserPersistence();
    const repo = new Repository(p);
    const first = await repo.transaction((s) => createBook(s, '原始', 'CNY'));
    await repo.transaction((s) => {
      s.books[0].name = '新名称';
    });
    await expect(p.write(first, first.revision)).rejects.toThrow('另一页面');
    expect((await p.read())?.books[0].name).toBe('新名称');
  });
  it('rolls back invalid refund restore instead of partially persisting it', async () => {
    const repo = new Repository(new BrowserPersistence());
    let refundId = '';
    await repo.transaction((s) => {
      const b = createBook(s, '日常', 'CNY');
      const e = saveEntry(s, {
        id: uid(),
        bookId: b.id,
        type: 'expense',
        currency: 'CNY',
        amount: '100',
        categoryId: s.categories[0].id,
        note: '',
        occurredAt: '2026-01-01T12:00',
      });
      const r = saveEntry(s, { ...e, id: uid(), type: 'refund', amount: '100', originalId: e.id });
      refundId = r.id;
      deleteEntry(s, r.id);
      saveEntry(s, { ...e, id: uid(), type: 'refund', amount: '100', originalId: e.id });
    });
    await expect(repo.transaction((s) => restoreEntry(s, refundId))).rejects.toThrow('退款总额');
    expect((await repo.load()).entries.find((e) => e.id === refundId)?.deletedAt).toBeDefined();
  });
  it('does not publish a write after storage failure', async () => {
    let stored: State | null = null;
    const p: Persistence = {
      read: async () => stored,
      write: async () => {
        throw new Error('disk full');
      },
      destroy: async () => {
        stored = null;
      },
    };
    const repo = new Repository(p);
    await expect(repo.transaction((s) => createBook(s, '不能保存', 'CNY'))).rejects.toThrow(
      'disk full',
    );
    expect((await repo.load()).books).toHaveLength(0);
  });
  it('clears all drafts and records with the vault', async () => {
    const p = new BrowserPersistence(),
      repo = new Repository(p);
    await repo.transaction((s) => createBook(s, '日常', 'CNY'));
    await repo.clear();
    expect((await repo.load()).books).toHaveLength(0);
  });
});
