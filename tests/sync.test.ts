import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nativeSqlite } from './helpers/native-sqlite';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import worker, { type Env } from '../worker';
import { BrowserPersistence, Repository } from '../src/storage';
import { emptyState, type State, uid, localTime } from '../src/model';
import { createBook, deleteEntry, saveEntry, purgeExpired } from '../src/domain';
import { applyCloud, cloudState, mergeStates, stable, SyncConflict } from '../src/sync/merge';
import { syncSummary } from '../src/bookOverview';
import { credentials, decryptState, encryptState, newSyncKey } from '../src/sync/crypto';
import { SyncClient } from '../src/sync/client';
import { readFileSync } from 'node:fs';

function backend() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_sync.sql', import.meta.url), 'utf8'));
  const env: Env = {
    SYNC_SETUP_CODE: 'test-create-code',
    DB: {
      prepare(sql) {
        let params: SQLInputValue[] = [];
        return {
          bind(...values) {
            params = values as SQLInputValue[];
            return this;
          },
          async first<T>() {
            return (db.prepare(sql).get(...params) ?? null) as T | null;
          },
          async run() {
            return { meta: { changes: Number(db.prepare(sql).run(...params).changes) } };
          },
        };
      },
    },
  };
  const request: typeof fetch = async (url, options) =>
    worker.fetch(new Request(new URL(String(url), 'https://ledger.test'), options), env);
  return { db, env, request };
}
function base() {
  const s = emptyState();
  createBook(s, '日常', 'CNY');
  return s;
}
function add(s: State, note: string, amount = '12.30') {
  return saveEntry(s, {
    id: uid(),
    bookId: s.books[0].id,
    type: 'expense',
    currency: 'CNY',
    categoryId: s.categories[0].id,
    amount,
    note,
    occurredAt: localTime(),
  });
}
vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: { closeConnection: async () => {}, clearEncryptionSecret: async () => {} },
}));
describe('encrypted cloud data', () => {
  it('rejects snapshots beyond the advertised cloud capacity without truncation', async () => {
    const s = base(),
      e = add(s, '测'.repeat(100));
    s.entries = Array.from({ length: 6000 }, (_, index) => ({ ...e, id: String(index) }));
    await expect(encryptState(s, newSyncKey())).rejects.toThrow('上限');
    expect(s.entries).toHaveLength(6000);
  });
  it('separates login credentials from encryption key, uses fresh IVs, and excludes device-only data', async () => {
    const key = newSyncKey(),
      s = base();
    add(s, '秘密账目');
    s.backups[s.books[0].id] = 123;
    const one = await encryptState(s, key),
      two = await encryptState(s, key);
    expect(one).not.toBe(two);
    expect(one).not.toContain('秘密账目');
    expect(await decryptState(one, key)).toEqual(cloudState(s));
    expect((await decryptState(one, key)).backups).toEqual({});
    await expect(decryptState(one, newSyncKey())).rejects.toThrow('无法解密');
    const damaged = JSON.parse(one);
    damaged.data = (damaged.data[0] === 'A' ? 'B' : 'A') + damaged.data.slice(1);
    await expect(decryptState(JSON.stringify(damaged), key)).rejects.toThrow('无法解密');
    await expect(credentials('password123')).rejects.toThrow('格式');
  });
});
describe('three-way merges', () => {
  it('opens a populated book on a new device without deleting same-name empty books or changing an existing selection', () => {
    const s = base();
    const firstId = s.activeBookId;
    createBook(s, '第二本', 'CNY');
    const second = s.books[1];
    second.name = s.books[0].name;
    saveEntry(s, {
      id: uid(),
      bookId: second.id,
      type: 'expense',
      currency: 'CNY',
      categoryId: s.categories.find((c) => c.bookId === second.id)!.id,
      amount: '520',
      note: '同步记录',
      occurredAt: '2025-01-15T12:00',
    });
    const restored = applyCloud(emptyState(), s);
    expect(restored.activeBookId).toBe(second.id);
    expect(restored.books).toHaveLength(2);
    const existing = structuredClone(s);
    existing.activeBookId = firstId;
    expect(applyCloud(existing, s).activeBookId).toBe(firstId);
    expect(syncSummary(restored)).toEqual({ books: 2, entries: 1 });
    deleteEntry(restored, restored.entries[0].id);
    expect(syncSummary(restored)).toEqual({ books: 2, entries: 0 });
  });
  it('preserves category order and detects incompatible reordering', () => {
    const b = base(),
      l = structuredClone(b),
      r = structuredClone(b);
    [l.categories[0], l.categories[1]] = [l.categories[1], l.categories[0]];
    expect(mergeStates(b, l, r).categories.map((c) => c.id)).toEqual(l.categories.map((c) => c.id));
    [r.categories[0], r.categories[2]] = [r.categories[2], r.categories[0]];
    expect(() => mergeStates(b, l, r)).toThrow(SyncConflict);
    expect(mergeStates(b, l, r, { 'categories/order': 'remote' }).categories).toEqual(r.categories);
  });
  it('asks before hiding newly added records inside a concurrently deleted book', () => {
    const b = base(),
      l = structuredClone(b),
      r = structuredClone(b);
    l.books[0].deletedAt = Date.now();
    add(r, '另一台刚记账');
    expect(() => mergeStates(b, l, r)).toThrow(SyncConflict);
    const result = mergeStates(b, l, r, { [`related/${b.books[0].id}`]: 'remote' });
    expect(result.books[0].deletedAt).toBeUndefined();
    expect(result.entries).toHaveLength(1);
  });
  it('combines offline additions, keeps money integer and currency scoped, and is idempotent', () => {
    const b = base(),
      l = structuredClone(b),
      r = structuredClone(b);
    add(l, '手机');
    add(r, '电脑');
    const merged = mergeStates(b, l, r);
    expect(merged.entries).toHaveLength(2);
    expect(merged.entries.every((e) => e.amount === 1230 && e.currency === 'CNY')).toBe(true);
    expect(mergeStates(b, merged, r)).toEqual(merged);
  });
  it('does not resurrect an unchanged record after deletion or retention purge', () => {
    const b = base();
    const e = add(b, '删除');
    const l = structuredClone(b);
    deleteEntry(l, e.id);
    expect(mergeStates(b, l, b).entries[0].deletedAt).toBeDefined();
    const tombstone = structuredClone(l);
    purgeExpired(l, Date.now() + 31 * 86400000);
    expect(mergeStates(tombstone, l, tombstone).entries).toHaveLength(0);
    expect(mergeStates(b, l, b).entries).toHaveLength(0);
  });
  it('requires explicit selection for edit-vs-delete and preserves unrelated additions', () => {
    const b = base(),
      e = add(b, '旧备注'),
      l = structuredClone(b),
      r = structuredClone(b);
    deleteEntry(l, e.id);
    r.entries[0].note = '另一台修改';
    r.entries[0].updatedAt++;
    add(r, '新的');
    expect(() => mergeStates(b, l, r)).toThrow(SyncConflict);
    const result = mergeStates(b, l, r, { [`entries/${e.id}`]: 'remote' });
    expect(result.entries).toHaveLength(2);
    expect(result.entries.find((x) => x.id === e.id)?.note).toBe('另一台修改');
  });
  it('blocks impossible combined refunds and allows explicit book-level selection', () => {
    const b = base(),
      e = add(b, '支出', '100'),
      l = structuredClone(b),
      r = structuredClone(b);
    for (const s of [l, r])
      saveEntry(s, { ...e, id: uid(), type: 'refund', originalId: e.id, amount: '70' });
    try {
      mergeStates(b, l, r);
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(SyncConflict);
      expect((error as SyncConflict).conflicts[0].key).toBe(`related/${e.bookId}`);
    }
    expect(mergeStates(b, l, r, { [`related/${e.bookId}`]: 'local' }).entries).toHaveLength(2);
  });
});
describe('Worker auth and atomic writes against SQLite', () => {
  it('requires registration code, isolates accounts, prevents stale overwrite, rejects cross-origin and invalid payloads', async () => {
    const { request, db } = backend(),
      a = await credentials(newSyncKey()),
      b = await credentials(newSyncKey());
    const call = (method: string, token = a.token, body?: object, extra = {}) =>
      request('/api/sync/v1/vault', {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
        body: body ? JSON.stringify(body) : undefined,
      });
    expect((await call('POST')).status).toBe(403);
    expect(
      (await call('POST', a.token, undefined, { 'X-Setup-Code': 'test-create-code' })).status,
    ).toBe(200);
    expect((await call('GET', b.token)).status).toBe(401);
    expect((await call('GET', a.token, undefined, { Origin: 'https://evil.test' })).status).toBe(
      403,
    );
    expect((await call('PUT', a.token, { revision: 0, payload: 'plaintext' })).status).toBe(400);
    const payload = await encryptState(base(), a.secret);
    const writes = await Promise.all([
      call('PUT', a.token, { revision: 0, payload }),
      call('PUT', a.token, { revision: 0, payload }),
    ]);
    expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await call('GET')).headers.get('Cache-Control')).toBe('no-store');
    const stored = db.prepare('SELECT * FROM sync_vaults').get()!;
    expect(stored.id).not.toBe(a.token);
    expect(stored.payload).not.toContain('日常');
    expect(
      (await call('PUT', a.token, { revision: 1, payload: 'x'.repeat(1_800_257) })).status,
    ).toBe(413);
    db.close();
  });
  it('returns useful unavailable status without affecting static assets', async () => {
    const response = await worker.fetch(new Request('https://ledger.test/api/sync/v1/vault'), {});
    expect(response.status).toBe(503);
    const status = await worker.fetch(new Request('https://ledger.test/api/sync/v1/status'), {});
    expect(await status.json()).toEqual({ enabled: false, registration: false });
  });
});
describe.each(['IndexedDB', 'SQLite'] as const)(
  'complete synchronization with independent %s devices',
  (storage) => {
    const databases: DatabaseSync[] = [];
    afterEach(() => databases.splice(0).forEach((db) => db.close()));
    function device(request: typeof fetch) {
      const native = storage === 'SQLite' ? nativeSqlite() : null;
      if (native) databases.push(native.db);
      const repo = new Repository(native?.persistence ?? new BrowserPersistence(uid()));
      return { repo, sync: new SyncClient(repo, request) };
    }
    it('rejects missing cloud payloads and rolled-back cloud versions without applying deletions', async () => {
      const { request, db } = backend();
      let broken = false;
      const a = device(async (url, options) =>
        broken && options?.method === 'GET'
          ? Response.json({ revision: 1, updated_at: Date.now() })
          : request(url, options),
      );
      const key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
        add(s, '保留');
      });
      await a.sync.connect(key, 'test-create-code');
      broken = true;
      await a.sync.sync();
      expect(a.sync.status.message).toContain('快照缺失');
      expect((await a.repo.load()).entries).toHaveLength(1);
      broken = false;
      db.prepare('UPDATE sync_vaults SET revision = 0, payload = NULL').run();
      await a.sync.sync();
      expect(a.sync.status.message).toContain('版本发生回退');
      expect((await a.repo.load()).entries).toHaveLength(1);
      db.close();
    });
    it('joins from an empty device, merges offline additions and creates recoverable snapshots', async () => {
      const { request, db } = backend(),
        a = device(request),
        b = device(request),
        key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
        add(s, '第一笔');
      });
      await a.sync.connect(key, 'test-create-code');
      await b.sync.connect(key);
      expect((await b.repo.load()).entries).toHaveLength(1);
      await a.repo.transaction((s) => {
        add(s, '离线 A');
      });
      await b.repo.transaction((s) => {
        add(s, '离线 B');
      });
      await a.sync.sync();
      await b.sync.sync();
      await a.sync.sync();
      expect((await a.repo.load()).entries).toHaveLength(3);
      expect(cloudState(await a.repo.load())).toEqual(cloudState(await b.repo.load()));
      const history = await a.repo.snapshots();
      expect(history.length).toBeGreaterThan(0);
      expect(JSON.parse(history[0].data).entries).toHaveLength(2);
      await b.sync.sync();
      expect((await b.repo.load()).entries).toHaveLength(3);
      db.close();
    });
    it('survives a lost PUT response, offline failure, reload, and later retry without duplicates', async () => {
      const { request, db } = backend();
      let lose = false,
        offline = false;
      const flaky: typeof fetch = async (url, options) => {
        if (offline) throw new TypeError('offline');
        const response = await request(url, options);
        if (lose && options?.method === 'PUT') {
          lose = false;
          throw new TypeError('response lost');
        }
        return response;
      };
      const a = device(flaky),
        key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
      });
      await a.sync.connect(key, 'test-create-code');
      await a.repo.transaction((s) => {
        add(s, '重试');
      });
      lose = true;
      await a.sync.sync();
      expect(a.sync.status.message).toContain('连接中断');
      offline = true;
      await a.sync.sync();
      expect((await a.repo.load()).entries).toHaveLength(1);
      offline = false;
      const reloaded = new SyncClient(a.repo, flaky);
      await reloaded.sync();
      expect(reloaded.status.message).toBe('已同步');
      const b = device(request);
      await b.sync.connect(key);
      expect((await b.repo.load()).entries).toHaveLength(1);
      db.close();
    });
    it('does not acknowledge or overwrite local edits made during upload', async () => {
      const { request, db } = backend();
      let duringUpload: (() => Promise<void>) | undefined;
      const wrapped: typeof fetch = async (url, options) => {
        const result = await request(url, options);
        if (options?.method === 'PUT' && duringUpload) {
          const fn = duringUpload;
          duringUpload = undefined;
          await fn();
        }
        return result;
      };
      const a = device(wrapped),
        key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
      });
      await a.sync.connect(key, 'test-create-code');
      await a.repo.transaction((s) => {
        add(s, '上传中');
      });
      duringUpload = async () => {
        await a.repo.transaction((s) => {
          add(s, '新修改');
        });
      };
      await a.sync.sync();
      expect((await a.repo.load()).entries).toHaveLength(2);
      await a.sync.sync();
      const b = device(request);
      await b.sync.connect(key);
      expect((await b.repo.load()).entries).toHaveLength(2);
      db.close();
    });
    it('keeps conflicts in both places, applies chosen row only, and rejects stale choices', async () => {
      const { request, db } = backend(),
        a = device(request),
        b = device(request),
        key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
        add(s, '原始');
      });
      await a.sync.connect(key, 'test-create-code');
      await b.sync.connect(key);
      await a.repo.transaction((s) => {
        s.entries[0].note = 'A';
      });
      await b.repo.transaction((s) => {
        s.entries[0].note = 'B';
      });
      await a.sync.sync();
      await b.sync.sync();
      expect(b.sync.status.conflicts).toHaveLength(1);
      expect((await b.repo.load()).entries[0].note).toBe('B');
      const stale = {
        localRevision: b.sync.status.localRevision,
        remoteRevision: b.sync.status.remoteRevision,
        choices: { [b.sync.status.conflicts[0].key]: 'remote' as const },
      };
      await b.repo.transaction((s) => {
        s.entries[0].note = 'B2';
      });
      await b.sync.sync(stale);
      expect((await b.repo.load()).entries[0].note).toBe('B2');
      expect(b.sync.status.conflicts).toHaveLength(1);
      await b.sync.sync({ ...stale, localRevision: b.sync.status.localRevision });
      expect((await b.repo.load()).entries[0].note).toBe('A');
      db.close();
    });
    it('disconnect/reconnect retains common ancestor; switching accounts requires clearing local data', async () => {
      const { request, db } = backend(),
        a = device(request),
        b = device(request),
        key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
        add(s, '将删除');
      });
      await a.sync.connect(key, 'test-create-code');
      await b.sync.connect(key);
      await b.sync.disconnect();
      await a.repo.transaction((s) => {
        deleteEntry(s, s.entries[0].id);
      });
      await a.sync.sync();
      await b.sync.connect(key);
      expect((await b.repo.load()).entries[0].deletedAt).toBeDefined();
      await b.sync.disconnect();
      await expect(b.sync.connect(newSyncKey(), 'test-create-code')).rejects.toThrow(
        '其他同步空间',
      );
      db.close();
    });
    it('clearing during an upload cannot resurrect local data or delete the cloud', async () => {
      const { request, db } = backend();
      let clear = false;
      const a = device(async (url, options) => {
        const response = await request(url, options);
        if (clear && options?.method === 'PUT') {
          clear = false;
          await a.repo.clear();
        }
        return response;
      });
      const key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
      });
      await a.sync.connect(key, 'test-create-code');
      await a.repo.transaction((s) => {
        add(s, '云端留存');
      });
      clear = true;
      await a.sync.sync();
      expect((await a.repo.load()).books).toHaveLength(0);
      expect((await a.repo.syncRead()).meta).toBeNull();
      const b = device(request);
      await b.sync.connect(key);
      expect((await b.repo.load()).entries).toHaveLength(1);
      db.close();
    });
    it('pauses sync after local protection restore', async () => {
      const { request, db } = backend(),
        a = device(request),
        key = newSyncKey();
      await a.repo.transaction((s) => {
        createBook(s, '日常', 'CNY');
      });
      await a.repo.protect('manual');
      const saved = (await a.repo.snapshots())[0];
      await a.sync.connect(key, 'test-create-code');
      await a.repo.transaction((s) => {
        add(s, '新账目');
      });
      await a.sync.sync();
      await a.repo.protect('restore', saved.id);
      expect((await a.repo.syncRead()).meta?.secret).toBeUndefined();
      await a.sync.sync();
      const b = device(request);
      await b.sync.connect(key);
      expect((await b.repo.load()).entries).toHaveLength(1);
      db.close();
    });
  },
);
