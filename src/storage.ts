import { t } from './i18n';
import { Capacitor } from '@capacitor/core';
import { type State, emptyState, validateState } from './model';
import { purgeExpired } from './domain';
import type { SyncMeta, SyncSnapshot } from './sync/types';
import {
  APP_VERSION,
  planProtection,
  protectionSchema,
  type ProtectionAction,
  type ProtectionSnapshot,
} from './protection';

function validateSyncMeta(value: SyncMeta | null | undefined): SyncMeta | null {
  if (!value) return null;
  if (
    typeof value.generation !== 'string' ||
    typeof value.accountId !== 'string' ||
    !Number.isFinite(value.syncedAt) ||
    !Number.isSafeInteger(value.cloudRevision) ||
    value.cloudRevision < 0 ||
    (value.secret !== undefined && typeof value.secret !== 'string')
  )
    throw new Error(t('同步配置损坏，请保留本地数据并导出备份'));
  return { ...value, base: validateState(value.base) };
}

export interface Persistence {
  read(): Promise<State | null>;
  write(state: State, previousRevision: number | null): Promise<void>;
  destroy(): Promise<void>;
  protect?(action: ProtectionAction): Promise<State | undefined>;
  snapshots?(): Promise<ProtectionSnapshot[]>;
  syncRead?(): Promise<SyncSnapshot>;
  syncWrite?(expected: SyncSnapshot, meta: SyncMeta | null, state?: State): Promise<void>;
}
export class BrowserPersistence implements Persistence {
  constructor(private databaseName = 'pocket-ledger-preview') {}
  private db?: Promise<IDBDatabase>;
  private open() {
    return (this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.databaseName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('vault');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error(t('请关闭其他旧版页面后重试')));
    }));
  }
  async read(): Promise<State | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('vault', 'readonly').objectStore('vault').get('state');
      req.onsuccess = () => {
        try {
          resolve(req.result === undefined ? null : validateState(req.result));
        } catch (error) {
          reject(error);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }
  async syncRead(): Promise<SyncSnapshot> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vault', 'readonly'),
        store = tx.objectStore('vault');
      const state = store.get('state'),
        meta = store.get('sync');
      tx.oncomplete = () => {
        try {
          const value = validateSyncMeta(meta.result);
          resolve({
            state: state.result ? validateState(state.result) : null,
            meta: value ?? null,
          });
        } catch (error) {
          reject(error);
        }
      };
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  async syncWrite(expected: SyncSnapshot, meta: SyncMeta | null, state?: State) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite'),
        store = tx.objectStore('vault');
      const current = store.get('state'),
        session = store.get('sync'),
        history = store.get('protection');
      let failure: unknown;
      history.onsuccess = () => {
        try {
          if (
            (current.result?.revision ?? null) !== (expected.state?.revision ?? null) ||
            (session.result?.generation ?? null) !== (expected.meta?.generation ?? null)
          )
            throw new Error(t('本地数据或同步账号已变化，请重试同步'));
          if (state) {
            const valid = validateState({
              ...state,
              revision: (expected.state?.revision ?? 0) + 1,
            });
            // Save the pre-merge state and merged state in the same transaction.
            if (current.result) {
              const plan = planProtection(
                JSON.stringify(current.result),
                history.result,
                { kind: 'manual', version: APP_VERSION },
                current.result.revision,
              );
              store.put(plan.archive, 'protection');
            }
            store.put(valid, 'state');
          }
          if (meta) store.put(meta, 'sync');
          else store.delete('sync');
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(failure ?? new Error(t('同步保存失败，本地数据保持原样')));
    });
  }
  async write(state: State, previousRevision: number | null) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite');
      let conflict = false;
      const store = tx.objectStore('vault'),
        read = store.get('state');
      read.onsuccess = () => {
        if ((read.result?.revision ?? null) !== previousRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(state, 'state');
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            conflict ? t('数据已在另一页面更新，请刷新后重试') : t('本地保存失败，请检查存储空间'),
          ),
        );
    });
  }
  async destroy() {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite');
      tx.objectStore('vault').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async snapshots() {
    const db = await this.open();
    return new Promise<ProtectionSnapshot[]>((resolve, reject) => {
      const req = db.transaction('vault', 'readonly').objectStore('vault').get('protection');
      req.onsuccess = () => {
        try {
          resolve(protectionSchema.parse(req.result ?? { snapshots: [] }).snapshots);
        } catch (error) {
          reject(error);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }
  async protect(action: ProtectionAction) {
    const db = await this.open();
    return new Promise<State | undefined>((resolve, reject) => {
      const tx = db.transaction('vault', 'readwrite'),
        store = tx.objectStore('vault');
      const current = store.get('state'),
        history = store.get('protection');
      let result: State | undefined, failure: unknown;
      history.onsuccess = () => {
        try {
          const change = planProtection(
            current.result === undefined ? null : JSON.stringify(current.result),
            history.result,
            action,
            Number.isSafeInteger(current.result?.revision) ? current.result.revision : null,
          );
          store.put(change.archive, 'protection');
          if (change.state) {
            result = change.state;
            store.put(result, 'state');
            // A local recovery is not consent to overwrite the cloud with an old snapshot.
            const sync = store.get('sync');
            sync.onsuccess = () => {
              if (sync.result)
                store.put(
                  { ...sync.result, secret: undefined, generation: crypto.randomUUID() },
                  'sync',
                );
            };
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(failure ?? new Error(t('本机保护副本保存失败，请检查存储空间')));
    });
  }
}
export class NativePersistence implements Persistence {
  constructor(
    private connect?: () => Promise<import('@capacitor-community/sqlite').SQLiteDBConnection>,
  ) {}
  private connection?: Promise<import('@capacitor-community/sqlite').SQLiteDBConnection>;
  private async open() {
    return (this.connection ??= (async () => {
      const db = this.connect ? await this.connect() : await this.openNative();
      await db.execute(
        'CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, data TEXT NOT NULL);',
      );
      await db.execute(
        'CREATE TABLE IF NOT EXISTS app_protection (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);',
      );
      await db.execute(
        'CREATE TABLE IF NOT EXISTS app_sync (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);',
      );
      return db;
    })());
  }
  private async openNative() {
    const { SQLiteConnection, CapacitorSQLite } = await import('@capacitor-community/sqlite');
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    // WebView reload resets JS wrappers while native connections remain alive.
    // Reconcile them before reopening, including after restoring a local snapshot.
    await sqlite.checkConnectionsConsistency();
    if (!(await sqlite.isSecretStored()).result) {
      // New random device secret; the plugin stores it in the OS secure store.
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join('');
      await sqlite.setEncryptionSecret(secret);
    }
    const db = await sqlite.createConnection('pocketledger', true, 'secret', 1, false);
    await db.open();
    return db;
  }
  async syncRead(): Promise<SyncSnapshot> {
    const db = await this.open();
    // One SQL statement reads both values from the same SQLite snapshot.
    const rows = await db.query(
      'SELECT (SELECT data FROM app_state WHERE id = 1) AS state, (SELECT data FROM app_sync WHERE id = 1) AS meta;',
    );
    const row = rows.values?.[0];
    return {
      state: row?.state ? validateState(JSON.parse(row.state)) : null,
      meta: validateSyncMeta(row?.meta ? JSON.parse(row.meta) : null),
    };
  }
  async syncWrite(expected: SyncSnapshot, meta: SyncMeta | null, state?: State) {
    const db = await this.open();
    await db.beginTransaction();
    try {
      const current = await this.syncRead();
      if (
        (current.state?.revision ?? null) !== (expected.state?.revision ?? null) ||
        (current.meta?.generation ?? null) !== (expected.meta?.generation ?? null)
      )
        throw new Error(t('本地数据或同步账号已变化，请重试同步'));
      if (state) {
        const valid = validateState({ ...state, revision: (current.state?.revision ?? 0) + 1 });
        if (current.state) {
          const history = await db.query('SELECT data FROM app_protection WHERE id = 1;');
          const plan = planProtection(
            JSON.stringify(current.state),
            history.values?.[0] ? JSON.parse(history.values[0].data) : undefined,
            { kind: 'manual', version: APP_VERSION },
            current.state.revision,
          );
          await db.run(
            'INSERT OR REPLACE INTO app_protection (id, data) VALUES (1, ?);',
            [JSON.stringify(plan.archive)],
            false,
          );
        }
        await db.run(
          'INSERT OR REPLACE INTO app_state (id, revision, data) VALUES (1, ?, ?);',
          [valid.revision, JSON.stringify(valid)],
          false,
        );
      }
      if (meta)
        await db.run(
          'INSERT OR REPLACE INTO app_sync (id, data) VALUES (1, ?);',
          [JSON.stringify(validateSyncMeta(meta))],
          false,
        );
      else await db.run('DELETE FROM app_sync WHERE id = 1;', [], false);
      await db.commitTransaction();
    } catch (error) {
      await db.rollbackTransaction();
      throw error;
    }
  }
  async read() {
    const db = await this.open();
    const result = await db.query('SELECT data FROM app_state WHERE id = 1;');
    return result.values?.[0] ? validateState(JSON.parse(result.values[0].data)) : null;
  }
  async write(state: State, revision: number | null) {
    const db = await this.open();
    const result =
      revision === null
        ? await db.run('INSERT INTO app_state (id, revision, data) VALUES (1, ?, ?);', [
            state.revision,
            JSON.stringify(state),
          ])
        : await db.run(
            'UPDATE app_state SET revision = ?, data = ? WHERE id = 1 AND revision = ?;',
            [state.revision, JSON.stringify(state), revision],
          );
    if (result.changes?.changes !== 1) throw new Error(t('数据发生变化，请重新打开页面后重试'));
  }
  async destroy() {
    const db = await this.open();
    await db.delete();
    const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
    await CapacitorSQLite.closeConnection({ database: 'pocketledger', readonly: false });
    await CapacitorSQLite.clearEncryptionSecret();
    this.connection = undefined;
  }
  async snapshots() {
    const db = await this.open();
    const rows = await db.query('SELECT data FROM app_protection WHERE id = 1;');
    return protectionSchema.parse(
      rows.values?.[0] ? JSON.parse(rows.values[0].data) : { snapshots: [] },
    ).snapshots;
  }
  async protect(action: ProtectionAction) {
    const db = await this.open();
    await db.beginTransaction();
    try {
      const rows = await db.query('SELECT revision, data FROM app_state WHERE id = 1;');
      const history = await db.query('SELECT data FROM app_protection WHERE id = 1;');
      const current = rows.values?.[0];
      const change = planProtection(
        current?.data ?? null,
        history.values?.[0] ? JSON.parse(history.values[0].data) : undefined,
        action,
        current?.revision ?? null,
      );
      await db.run(
        'INSERT OR REPLACE INTO app_protection (id, data) VALUES (1, ?);',
        [JSON.stringify(change.archive)],
        false,
      );
      if (change.state) {
        await db.run(
          'INSERT OR REPLACE INTO app_state (id, revision, data) VALUES (1, ?, ?);',
          [change.state.revision, JSON.stringify(change.state)],
          false,
        );
        const session = await db.query('SELECT data FROM app_sync WHERE id = 1;');
        if (session.values?.[0]) {
          const meta = JSON.parse(session.values[0].data);
          await db.run(
            'UPDATE app_sync SET data = ? WHERE id = 1;',
            [JSON.stringify({ ...meta, secret: undefined, generation: crypto.randomUUID() })],
            false,
          );
        }
      }
      await db.commitTransaction();
      return change.state;
    } catch (error) {
      await db.rollbackTransaction();
      throw error;
    }
  }
}
export class Repository {
  private listeners = new Set<(kind: 'local' | 'sync' | 'clear') => void>();
  subscribe(listener: (kind: 'local' | 'sync' | 'clear') => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed(kind: 'local' | 'sync' | 'clear') {
    this.listeners.forEach((fn) => fn(kind));
  }
  private queue: Promise<unknown> = Promise.resolve();
  private prepared?: Promise<unknown>;
  constructor(
    private persistence: Persistence,
    private appVersion = APP_VERSION,
  ) {}
  private prepare() {
    return (this.prepared ??= Promise.resolve()
      .then(() => this.persistence.protect?.({ kind: 'prepare', version: this.appVersion }))
      .catch((error) => {
        this.prepared = undefined;
        throw error;
      }));
  }
  async idle() {
    await this.queue;
  }
  async load() {
    await this.prepare();
    return (await this.persistence.read()) ?? emptyState();
  }
  transaction(change: (state: State) => void): Promise<State> {
    const task = this.queue.then(async () => {
      await this.prepare();
      const stored = await this.persistence.read();
      const draft = stored ? structuredClone(stored) : emptyState();
      purgeExpired(draft);
      change(draft);
      draft.revision = (stored?.revision ?? 0) + 1;
      const valid = validateState(draft);
      await this.persistence.write(valid, stored?.revision ?? null);
      this.changed('local');
      return valid;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  clear(): Promise<State> {
    const task = this.queue.then(async () => {
      await this.persistence.destroy();
      this.prepared = undefined;
      this.changed('clear');
      return emptyState();
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  async snapshots() {
    return this.persistence.snapshots?.() ?? [];
  }
  async syncRead() {
    await this.queue;
    await this.prepare();
    if (!this.persistence.syncRead) throw new Error(t('此存储不支持云同步'));
    return this.persistence.syncRead();
  }
  syncWrite(expected: SyncSnapshot, meta: SyncMeta | null, state?: State) {
    const task = this.queue.then(async () => {
      if (!this.persistence.syncWrite) throw new Error(t('此存储不支持云同步'));
      await this.persistence.syncWrite(expected, meta, state);
      this.changed('sync');
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  protect(kind: 'manual' | 'restore', id = '') {
    const task = this.queue.then(async () => {
      if (!this.persistence.protect) throw new Error(t('当前存储不支持本机保护'));
      // Recovery must remain available when normal loading/validation fails.
      const state = await this.persistence.protect(
        kind === 'restore'
          ? { kind, id, version: this.appVersion }
          : { kind, version: this.appVersion },
      );
      if (kind === 'restore') this.prepared = Promise.resolve();
      if (kind === 'restore') this.changed('sync');
      return state;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
export const repository = new Repository(
  Capacitor.isNativePlatform() ? new NativePersistence() : new BrowserPersistence(),
);
export const isNative = Capacitor.isNativePlatform();
