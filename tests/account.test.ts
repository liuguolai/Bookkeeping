import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { type Env } from '../worker';
import {
  AccountClient,
  normalizeUsername,
  validatePassword,
  wrapSyncKey,
} from '../src/sync/account';
import { credentials, newSyncKey } from '../src/sync/crypto';

const password = 'A long unique ledger password';
const changed = 'Another long unique ledger password';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
async function fixture(migrate = true) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  for (const file of ['0001_sync.sql', ...(migrate ? ['0002_accounts.sql'] : [])])
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const env: Env = {
    AUTH_RATE_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
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
  const secret = newSyncKey();
  const identity = await credentials(secret);
  db.prepare('INSERT INTO sync_vaults VALUES (?, 7, ?, ?)').run(
    identity.accountId,
    'existing-encrypted-ledger',
    123,
  );
  const client = new AccountClient(request);
  const call = (path: string, method = 'POST', data: unknown = {}, headers = {}) =>
    request(`/api/sync/v1/account${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${identity.token}`,
        ...headers,
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data) }),
    });
  return { db, env, request, secret, identity, client, call };
}

describe('password access to existing encrypted spaces', () => {
  it('normalizes account names and enforces long passwords without trimming them', () => {
    expect(normalizeUsername(' My_Ledger-1 ')).toBe('my_ledger-1');
    expect(() => normalizeUsername('a@b.com')).toThrow();
    expect(() => validatePassword('Abc1234')).toThrow();
    expect(() => validatePassword('Abc12345')).not.toThrow();
    expect(() => validatePassword('x'.repeat(128))).not.toThrow();
    expect(() => validatePassword('x'.repeat(129))).toThrow();
    expect(() => validatePassword('这是一句我能记住而且足够长的独特密码')).not.toThrow();
  });
  it('binds and unlocks the original key without modifying ledger payload or revision', async () => {
    const f = await fixture();
    expect(await f.client.current(f.secret)).toBeNull();
    await f.client.bind(f.secret, 'My_Ledger', password);
    expect(await f.client.login('MY_LEDGER', password)).toBe(f.secret);
    expect(await f.client.current(f.secret)).toEqual({ username: 'my_ledger', revision: 1 });
    expect(f.db.prepare('SELECT revision, payload FROM sync_vaults').get()).toEqual({
      revision: 7,
      payload: 'existing-encrypted-ledger',
    });
    const stored = JSON.stringify(f.db.prepare('SELECT * FROM sync_accounts').get());
    expect(stored).not.toContain(password);
    expect(stored).not.toContain(f.secret);
    const response = await f.call('', 'GET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain('wrapped_key');
  });
  it('rejects wrong and unknown logins with the same error without changing the account', async () => {
    const f = await fixture();
    await f.client.bind(f.secret, 'ledger', password);
    await expect(f.client.login('ledger', changed)).rejects.toThrow('账号或密码不正确');
    await expect(f.client.login('unknown', password)).rejects.toThrow('账号或密码不正确');
    expect(await f.client.login('ledger', password)).toBe(f.secret);
  });
  it('changes passwords, rejects stale revisions, and retains original-key access', async () => {
    const f = await fixture();
    await f.client.bind(f.secret, 'ledger', password);
    await f.client.bind(f.secret, 'ledger', changed, 1);
    await expect(f.client.bind(f.secret, 'ledger', password, 1)).rejects.toThrow('另一台设备');
    await expect(f.client.login('ledger', password)).rejects.toThrow('账号或密码不正确');
    expect(await f.client.login('ledger', changed)).toBe(f.secret);
    expect(
      (
        await f.request('/api/sync/v1/vault', {
          headers: { Authorization: `Bearer ${f.identity.token}` },
        })
      ).status,
    ).toBe(200);
  });
  it('recovers account name and password with the original key only', async () => {
    const f = await fixture();
    await f.client.bind(f.secret, 'ledger', password);
    expect(await f.client.recover(f.secret, changed)).toBe('ledger');
    expect(await f.client.login('ledger', changed)).toBe(f.secret);
    await expect(f.client.recover(newSyncKey(), password)).rejects.toThrow('同步空间不存在');
  });
  it('allows only one account per vault and one vault per username; cannot rename', async () => {
    const f = await fixture();
    await f.client.bind(f.secret, 'ledger', password);
    await expect(f.client.bind(f.secret, 'other', changed)).rejects.toThrow('已绑定');
    await expect(f.client.bind(f.secret, 'other', changed, 1)).rejects.toThrow('状态已变化');
    const other = newSyncKey(),
      identity = await credentials(other);
    f.db.prepare('INSERT INTO sync_vaults VALUES (?, 0, NULL, ?)').run(identity.accountId, 1);
    await expect(f.client.bind(other, 'ledger', changed)).rejects.toThrow('已被使用');
    expect(f.db.prepare('SELECT count(*) AS n FROM sync_accounts').get()?.n).toBe(1);
  });
  it('authenticates encrypted-key metadata and rejects tampering', async () => {
    const f = await fixture();
    await f.client.bind(f.secret, 'ledger', password);
    const client = new AccountClient(async (url, options) => {
      const response = await f.request(url, options);
      if (!String(url).endsWith('/login')) return response;
      const data = await response.json();
      data.vaultId = 'A'.repeat(43);
      return Response.json(data);
    });
    await expect(client.login('ledger', password)).rejects.toThrow('无法解锁');
    expect(await f.client.login('ledger', password)).toBe(f.secret);
  });
  it('can discover a successful bind after its response was lost', async () => {
    const f = await fixture();
    const client = new AccountClient(async (url, options) => {
      const response = await f.request(url, options);
      if (options?.method === 'POST') throw new TypeError('connection lost');
      return response;
    });
    await expect(client.bind(f.secret, 'ledger', password)).rejects.toThrow('重新打开账号设置');
    expect(await client.current(f.secret)).toEqual({ username: 'ledger', revision: 1 });
    expect(await f.client.login('ledger', password)).toBe(f.secret);
  });
  it('fails closed without a migration or limiter, while original vault access still works', async () => {
    const f = await fixture(false);
    expect((await f.call('', 'GET')).status).toBe(503);
    expect(
      (
        await f.request('/api/sync/v1/vault', {
          headers: { Authorization: `Bearer ${f.identity.token}` },
        })
      ).status,
    ).toBe(200);
    f.env.AUTH_RATE_LIMIT = undefined;
    expect((await f.call('/challenge', 'POST', { username: 'ledger' })).status).toBe(503);
  });
  it('limits requests before database access and applies both IP and account login limits', async () => {
    const f = await fixture();
    const keys: string[] = [];
    f.env.AUTH_RATE_LIMIT = {
      async limit({ key }) {
        keys.push(key);
        return { success: !key.startsWith('login:') };
      },
    };
    expect((await f.call('/login', 'POST', { username: 'ledger' })).status).toBe(429);
    expect(keys).toEqual(['ip:local', 'login:ledger']);
    f.env.AUTH_RATE_LIMIT = {
      async limit() {
        return { success: false };
      },
    };
    expect((await f.call('', 'GET')).status).toBe(429);
  });
  it('rejects cross-origin, missing ownership, malformed/oversized body, and unsupported methods', async () => {
    const f = await fixture();
    expect((await f.call('', 'GET', {}, { Origin: 'https://other.test' })).status).toBe(403);
    expect((await f.call('', 'GET', {}, { Authorization: '' })).status).toBe(401);
    expect((await f.call('/challenge', 'POST', { username: 'x'.repeat(5000) })).status).toBe(400);
    expect((await f.call('/challenge', 'POST', [])).status).toBe(400);
    expect((await f.call('/login', 'GET')).status).toBe(405);
    expect((await f.call('/unknown', 'GET')).status).toBe(404);
    const wrapped = await wrapSyncKey('ledger', password, f.secret);
    expect((await f.call('', 'POST', { ...wrapped, revision: 0, wrappedKey: '{}' })).status).toBe(
      400,
    );
    expect(await f.client.current(f.secret)).toBeNull();
  });
});
