import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeSqlite } from './helpers/native-sqlite';
import { Repository } from '../src/storage';
import { createBook } from '../src/domain';
import { emptyState } from '../src/model';
import type { SyncMeta } from '../src/sync/types';
import { createSyncRequest, nativeSyncUrl, NATIVE_SYNC_ORIGIN } from '../src/sync/transport';
import type { HttpOptions, HttpResponse } from '@capacitor/core';

const fixtures: ReturnType<typeof nativeSqlite>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.db.close()));
function fixture() {
  const f = nativeSqlite();
  fixtures.push(f);
  return { ...f, repo: new Repository(f.persistence) };
}
function meta(): SyncMeta {
  return {
    accountId: 'test',
    secret: 'test-secret',
    generation: crypto.randomUUID(),
    syncedAt: 0,
    cloudRevision: 0,
    base: emptyState(),
  };
}

describe('native SQLite sync transactions', () => {
  it('upgrades existing local tables without losing data or requiring a cloud connection', async () => {
    const f = fixture(),
      old = emptyState();
    createBook(old, '旧账本', 'HKD');
    old.revision = 9;
    f.db.exec(
      'CREATE TABLE app_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);',
    );
    f.db.prepare('INSERT INTO app_state VALUES (1, ?, ?)').run(9, JSON.stringify(old));
    expect(await f.repo.load()).toEqual(old);
    expect((await f.repo.syncRead()).meta).toBeNull();
    expect((await f.repo.snapshots())[0].reason).toBe('upgrade');
  });
  it('rolls back state and protection when saving sync metadata fails', async () => {
    const f = fixture();
    await f.repo.transaction((s) => {
      createBook(s, '原账本', 'CNY');
    });
    const before = await f.repo.syncRead(),
      history = await f.repo.snapshots();
    const changed = structuredClone(before.state!);
    changed.books[0].name = '云端修改';
    f.failSyncWrite();
    await expect(f.repo.syncWrite(before, meta(), changed)).rejects.toThrow('disk full');
    expect(await f.repo.syncRead()).toEqual(before);
    expect(await f.repo.snapshots()).toEqual(history);
  });
  it('rejects a stale connection generation without replacing local data', async () => {
    const f = fixture();
    await f.repo.transaction((s) => {
      createBook(s, '日常', 'CNY');
    });
    const before = await f.repo.syncRead();
    await f.repo.syncWrite(before, meta());
    await expect(f.repo.syncWrite(before, meta(), emptyState())).rejects.toThrow('已变化');
    expect((await f.repo.load()).books).toHaveLength(1);
  });
});

describe('Android sync transport', () => {
  it('sends JSON and authorization only to the HTTPS service and disables redirects', async () => {
    const http = vi.fn(async (o: HttpOptions): Promise<HttpResponse> => ({
      url: o.url,
      status: 200,
      data: { revision: 4 },
      headers: { 'content-type': 'application/json' },
    }));
    const request = createSyncRequest(true, http);
    const response = await request('/api/sync/v1/vault', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 3, payload: 'encrypted' }),
    });
    expect(await response.json()).toEqual({ revision: 4 });
    expect(http.mock.calls[0][0]).toMatchObject({
      url: `${NATIVE_SYNC_ORIGIN}/api/sync/v1/vault`,
      disableRedirects: true,
      data: { revision: 3, payload: 'encrypted' },
      headers: { authorization: 'Bearer test' },
    });
    for (const path of [
      'https://evil.test/api/sync/v1/vault',
      '//evil.test',
      '/api/sync/v1/../vault',
    ])
      await expect(request(path)).rejects.toThrow('地址无效');
    expect(http).toHaveBeenCalledTimes(1);
    expect(() => nativeSyncUrl('/api/sync/v1/vault', 'http://localhost')).toThrow();
  });
  it('discards late native responses after abort and rejects redirects', async () => {
    let finish!: (r: HttpResponse) => void;
    const request = createSyncRequest(
      true,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = request('/api/sync/v1/vault', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    finish({ status: 200, data: {}, headers: {}, url: NATIVE_SYNC_ORIGIN });
    const redirect = createSyncRequest(true, async () => ({
      status: 302,
      data: '',
      headers: {},
      url: NATIVE_SYNC_ORIGIN,
    }));
    await expect(redirect('/api/sync/v1/vault')).rejects.toThrow(TypeError);
  });
  it('keeps PWA requests same-origin', async () => {
    const browser = vi.fn(async () => Response.json({ ok: true }));
    const native = vi.fn();
    await createSyncRequest(
      false,
      native,
      browser,
    )('/api/sync/v1/account/login', { method: 'POST' });
    expect(browser.mock.calls[0]).toEqual(['/api/sync/v1/account/login', { method: 'POST' }]);
    expect(native).not.toHaveBeenCalled();
  });
});
