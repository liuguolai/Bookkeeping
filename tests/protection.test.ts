import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { BrowserPersistence, Repository } from '../src/storage';
import { createBook } from '../src/domain';
import { emptyState } from '../src/model';
import { planProtection } from '../src/protection';

async function raw(value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const r = indexedDB.open('pocket-ledger-preview', 1);
    r.onsuccess = () => resolve(r.result);
  });
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('vault', 'readwrite');
    t.objectStore('vault').put(value, 'state');
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error);
  });
  db.close();
}
beforeEach(async () => {
  await new BrowserPersistence().destroy();
});
it('keeps exact legacy data before migration and only snapshots once per version', async () => {
  const old = emptyState();
  createBook(old, '旧账本', 'JPY');
  const legacy = { ...old, version: 1, templates: undefined };
  await raw(legacy);
  const repo = new Repository(new BrowserPersistence(), '0.1.7');
  expect((await repo.transaction(() => {})).version).toBe(2);
  expect(JSON.parse((await repo.snapshots())[0].data)).toEqual(JSON.parse(JSON.stringify(legacy)));
  await new Repository(new BrowserPersistence(), '0.1.7').load();
  expect(await repo.snapshots()).toHaveLength(1);
  await new Repository(new BrowserPersistence(), '0.1.8').load();
  expect(await repo.snapshots()).toHaveLength(2);
  await expect(new Repository(new BrowserPersistence(), '0.1.7').load()).rejects.toThrow(
    '更新版本',
  );
});
it('atomically restores all data with a fresh revision and allows undo', async () => {
  const repo = new Repository(new BrowserPersistence());
  await repo.transaction((s) => createBook(s, '原始', 'CNY'));
  await repo.protect('manual');
  const saved = (await repo.snapshots())[0];
  const later = await repo.transaction((s) => {
    s.books[0].name = '之后';
  });
  await repo.protect('restore', saved.id);
  expect((await repo.load()).books[0].name).toBe('原始');
  expect((await repo.load()).revision).toBeGreaterThan(later.revision);
  const undo = (await repo.snapshots())[0];
  expect(undo.reason).toBe('before-restore');
  await repo.protect('restore', undo.id);
  expect((await repo.load()).books[0].name).toBe('之后');
  for (let i = 0; i < 4; i++) await repo.protect('manual');
  expect(await repo.snapshots()).toHaveLength(3);
  await repo.clear();
  expect(await repo.snapshots()).toHaveLength(0);
});
it('recovers from unreadable current data and preserves it for diagnosis', async () => {
  const repo = new Repository(new BrowserPersistence());
  await repo.transaction((s) => createBook(s, '可恢复', 'HKD'));
  await repo.protect('manual');
  const saved = (await repo.snapshots())[0];
  await raw({ broken: true });
  await expect(repo.load()).rejects.toThrow();
  await repo.protect('restore', saved.id);
  expect((await repo.load()).books[0].name).toBe('可恢复');
  expect(JSON.parse((await repo.snapshots())[0].data)).toEqual({ broken: true });
});
it('rejects missing or corrupt snapshots without changing the vault', async () => {
  const repo = new Repository(new BrowserPersistence());
  const before = await repo.transaction((s) => createBook(s, '保留', 'CNY'));
  await expect(repo.protect('restore', 'missing')).rejects.toThrow('不存在');
  expect(await repo.load()).toEqual(before);
  expect(() =>
    planProtection(
      JSON.stringify(before),
      {
        snapshots: [
          {
            id: 'x',
            createdAt: 1,
            reason: 'manual',
            fromVersion: '0.1.7',
            toVersion: '0.1.7',
            data: '{}',
          },
        ],
      },
      { kind: 'restore', version: '0.1.7', id: 'x' },
      1,
    ),
  ).toThrow();
});
it('blocks business writes when pre-upgrade protection fails', async () => {
  let writes = 0;
  const repo = new Repository({
    read: async () => null,
    write: async () => {
      writes++;
    },
    destroy: async () => {},
    protect: async () => {
      throw new Error('disk full');
    },
  });
  await expect(repo.transaction((s) => createBook(s, '禁止写入', 'CNY'))).rejects.toThrow(
    'disk full',
  );
  expect(writes).toBe(0);
});
