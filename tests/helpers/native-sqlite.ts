import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { NativePersistence } from '../../src/storage';

// Executes the production adapter's SQL against real SQLite. Encryption and the
// Capacitor bridge still require an Android runtime check.
export function nativeSqlite() {
  const db = new DatabaseSync(':memory:');
  let failSyncWrite = false;
  const connection = {
    async execute(sql: string) {
      db.exec(sql);
    },
    async query(sql: string, values: SQLInputValue[] = []) {
      return { values: db.prepare(sql).all(...values) };
    },
    async run(sql: string, values: SQLInputValue[] = []) {
      if (failSyncWrite && sql.includes('INTO app_sync')) throw new Error('disk full');
      return { changes: { changes: Number(db.prepare(sql).run(...values).changes) } };
    },
    async beginTransaction() {
      db.exec('BEGIN TRANSACTION');
    },
    async commitTransaction() {
      db.exec('COMMIT');
    },
    async rollbackTransaction() {
      db.exec('ROLLBACK');
    },
    async delete() {
      db.exec(
        'DROP TABLE IF EXISTS app_state; DROP TABLE IF EXISTS app_protection; DROP TABLE IF EXISTS app_sync;',
      );
    },
  } as unknown as SQLiteDBConnection;
  return {
    db,
    persistence: new NativePersistence(async () => connection),
    failSyncWrite: () => {
      failSyncWrite = true;
    },
  };
}
