import { z } from 'zod';
import { uid, validateState, type State } from './model';
import packageInfo from '../package.json';

export const APP_VERSION = packageInfo.version;
export const protectionSchema = z.object({
  appVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  snapshots: z
    .array(
      z.object({
        id: z.string(),
        createdAt: z.number().int().nonnegative(),
        reason: z.enum(['upgrade', 'manual', 'before-restore']),
        fromVersion: z.string(),
        toVersion: z.string(),
        data: z.string(),
      }),
    )
    .max(3),
});
export type ProtectionSnapshot = z.infer<typeof protectionSchema>['snapshots'][number];
export type ProtectionAction =
  | { kind: 'prepare'; version: string }
  | { kind: 'manual'; version: string }
  | { kind: 'restore'; version: string; id: string };

export function planProtection(
  raw: string | null,
  stored: unknown,
  action: ProtectionAction,
  revision: number | null,
) {
  const archive = protectionSchema.parse(stored ?? { snapshots: [] });
  if (archive.appVersion) {
    const a = archive.appVersion.split('.').map(Number),
      b = action.version.split('.').map(Number);
    const first = a.findIndex((n, i) => n !== b[i]);
    if (first !== -1 && a[first] > b[first])
      throw new Error('数据已由更新版本使用，请升级应用后再打开');
  }
  const add = (reason: ProtectionSnapshot['reason']) => {
    if (raw === null) return;
    archive.snapshots.unshift({
      id: uid(),
      createdAt: Date.now(),
      reason,
      fromVersion: archive.appVersion ?? '未标记版本',
      toVersion: action.version,
      data: raw,
    });
    archive.snapshots = archive.snapshots.slice(0, 3);
  };
  let state: State | undefined;
  if (action.kind === 'prepare') {
    if (archive.appVersion !== action.version) add('upgrade');
  } else if (action.kind === 'manual') {
    if (raw === null) throw new Error('还没有可保护的本地数据');
    validateState(JSON.parse(raw));
    add('manual');
  } else {
    const selected = archive.snapshots.find((s) => s.id === action.id);
    if (!selected) throw new Error('保护副本已不存在，请重新选择');
    state = validateState(JSON.parse(selected.data));
    state.revision = Math.max(state.revision, revision ?? 0) + 1;
    if (!Number.isSafeInteger(state.revision)) throw new Error('数据版本异常，无法恢复');
    // Preserve even unreadable current data before replacing it; both writes commit together.
    add('before-restore');
  }
  archive.appVersion = action.version;
  return { archive, state };
}
