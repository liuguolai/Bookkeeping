import type { State } from '../model';
export interface SyncMeta {
  generation: string;
  accountId: string;
  secret?: string;
  base: State;
  syncedAt: number;
  cloudRevision: number;
}
export interface SyncSnapshot {
  state: State | null;
  meta: SyncMeta | null;
}
