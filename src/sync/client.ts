import { emptyState } from '../model';
import { repository, type Repository } from '../storage';
import { syncRequest } from './transport';
export { syncSupported } from './transport';
import { credentials, encryptState, decryptState } from './crypto';
import {
  applyCloud,
  cloudState,
  mergeStates,
  stable,
  SyncConflict,
  type Choice,
  type Conflict,
} from './merge';
import type { SyncSnapshot } from './types';
import { syncSummary } from '../bookOverview';

type Remote = { revision: number; payload: string | null; updated_at: number };
type Resolution = {
  localRevision: number;
  remoteRevision: number;
  choices: Record<string, Choice>;
};
export type SyncStatus = {
  connected: boolean;
  accountId: string;
  busy: boolean;
  message: string;
  syncedAt: number;
  conflicts: Conflict[];
  localRevision: number;
  remoteRevision: number;
  summary: ReturnType<typeof syncSummary> | null;
};
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export class SyncClient {
  status: SyncStatus = {
    connected: false,
    accountId: '',
    busy: false,
    message: '未开启云同步',
    syncedAt: 0,
    conflicts: [],
    localRevision: 0,
    remoteRevision: 0,
    summary: null,
  };
  private listeners = new Set<() => void>();
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private failures = 0;
  constructor(
    private repo: Repository,
    private request: typeof fetch = syncRequest,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.status;
  private set(value: Partial<SyncStatus>) {
    this.status = { ...this.status, ...value };
    this.listeners.forEach((fn) => fn());
  }
  async refresh() {
    const { meta } = await this.repo.syncRead();
    this.set({
      connected: !!meta?.secret,
      accountId: meta?.accountId ?? '',
      syncedAt: meta?.syncedAt ?? 0,
      summary: meta?.syncedAt ? syncSummary(meta.base) : null,
      ...(!meta?.secret
        ? { message: meta ? '已断开，账目保留在本机' : '未开启云同步', conflicts: [] }
        : {}),
    });
  }
  private async api(
    method: string,
    secret: string,
    body?: object,
    setup?: string,
  ): Promise<Remote> {
    const { token } = await credentials(secret);
    const controller = new AbortController();
    this.abort = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.request('/api/sync/v1/vault', {
        method,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(setup ? { 'X-Setup-Code': setup } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.headers.get('Content-Type')?.includes('application/json'))
        throw new Error('当前服务尚未部署云同步接口，本地记账可继续使用');
      const data = await response.json();
      if (!response.ok) throw new ApiError(data.error ?? '同步请求失败', response.status);
      if (
        method !== 'POST' &&
        (!Number.isSafeInteger(data.revision) ||
          data.revision < 0 ||
          !Number.isFinite(data.updated_at))
      )
        throw new Error('云服务返回了不支持的数据');
      if (
        method === 'GET' &&
        ((typeof data.payload !== 'string' && data.payload !== null) ||
          (data.payload === null && data.revision !== 0))
      )
        throw new Error('云端快照缺失或格式错误，本地数据保留，请联系管理员检查数据库');
      return data;
    } finally {
      clearTimeout(timer);
      if (this.abort === controller) this.abort = undefined;
    }
  }
  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request('pocket-ledger-cloud-sync', fn);
    return fn(); // IndexedDB and cloud compare-and-swap remain the correctness boundary.
  }
  async connect(secret: string, setup?: string) {
    if (this.status.busy) throw new Error('请等待当前同步完成');
    this.set({ busy: true });
    try {
      await this.lock(async () => {
        const identity = await credentials(secret),
          before = await this.repo.syncRead();
        if (before.meta?.accountId && before.meta.accountId !== identity.accountId)
          throw new Error(
            '本机账目已关联其他同步空间。请先导出备份并清空本机，再连接其他密钥，避免混入不同账号的数据',
          );
        if (setup !== undefined) await this.api('POST', identity.secret, undefined, setup);
        const remote = await this.api('GET', identity.secret);
        if (remote.payload) await decryptState(remote.payload, identity.secret);
        await this.repo.syncWrite(before, {
          accountId: identity.accountId,
          secret: identity.secret,
          generation: crypto.randomUUID(),
          base: before.meta?.base ?? emptyState(),
          syncedAt: before.meta?.syncedAt ?? 0,
          cloudRevision: before.meta?.cloudRevision ?? 0,
        });
      });
      await this.refresh();
    } finally {
      this.set({ busy: false });
    }
    await this.sync();
  }
  async disconnect() {
    this.abort?.abort();
    clearTimeout(this.timer);
    await this.lock(async () => {
      const before = await this.repo.syncRead();
      if (before.meta)
        await this.repo.syncWrite(before, {
          ...before.meta,
          secret: undefined,
          generation: crypto.randomUUID(),
        });
    });
    await this.refresh();
  }
  async savedKey() {
    return (await this.repo.syncRead()).meta?.secret ?? '';
  }
  schedule(delay = 3000) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.sync();
    }, delay);
  }
  sync(resolution?: Resolution): Promise<void> {
    if (this.running) return this.running;
    this.running = this.lock(async () => {
      const before = await this.repo.syncRead();
      if (!before.meta?.secret) {
        await this.refresh();
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.set({ message: '离线中，修改已保存在本机，联网后同步' });
        return;
      }
      this.set({
        busy: true,
        connected: true,
        accountId: before.meta.accountId,
        message: '正在同步…',
      });
      await this.exchange(before, resolution);
      this.failures = 0;
    })
      .catch((error) => {
        this.failures++;
        if (error instanceof SyncConflict) return; // Already published with revision guards.
        this.set({
          message:
            error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')
              ? '连接中断或超时，修改仍保存在本机，稍后重试'
              : error instanceof Error
                ? error.message
                : '同步失败，请稍后重试',
        });
      })
      .finally(() => {
        this.running = undefined;
        this.set({ busy: false });
      });
    return this.running;
  }
  private async exchange(before: SyncSnapshot, resolution?: Resolution) {
    const meta = before.meta!,
      local = before.state ?? emptyState(),
      remote = await this.api('GET', meta.secret!);
    if (remote.revision < meta.cloudRevision)
      throw new Error('云端版本发生回退，本地数据保留，请先导出备份并联系管理员检查数据库');
    const cloud = remote.payload ? await decryptState(remote.payload, meta.secret!) : emptyState();
    const choices =
      resolution &&
      resolution.localRevision === local.revision &&
      resolution.remoteRevision === remote.revision
        ? resolution.choices
        : {};
    let merged;
    try {
      merged = mergeStates(meta.base, cloudState(local), cloud, choices);
    } catch (error) {
      if (error instanceof SyncConflict)
        this.set({
          conflicts: error.conflicts,
          localRevision: local.revision,
          remoteRevision: remote.revision,
          message: error.message,
        });
      throw error;
    }
    const current = await this.repo.syncRead();
    if (
      current.meta?.generation !== meta.generation ||
      (current.state?.revision ?? 0) !== local.revision
    )
      throw new Error('本机有新修改，将在下一次同步时合并');
    let acknowledgedRevision = remote.revision;
    if (stable(merged) !== stable(cloud)) {
      const uploaded = await this.api('PUT', meta.secret!, {
        revision: remote.revision,
        payload: await encryptState(merged, meta.secret!),
      });
      acknowledgedRevision = uploaded.revision;
    }
    const changed = stable(cloudState(local)) !== stable(merged);
    await this.repo.syncWrite(
      before,
      {
        ...meta,
        base: merged,
        generation: crypto.randomUUID(),
        syncedAt: Date.now(),
        cloudRevision: acknowledgedRevision,
      },
      changed ? applyCloud(local, merged) : undefined,
    );
    this.set({
      message: '已同步',
      syncedAt: Date.now(),
      conflicts: [],
      summary: syncSummary(merged),
    });
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('pocket-ledger-sync');
      channel.postMessage('changed');
      channel.close();
    }
  }
  start() {
    void this.refresh()
      .then(() => this.sync())
      .catch(() => this.set({ message: '同步配置读取失败，本地记账不受影响' }));
    const unsubscribe = this.repo.subscribe((kind) => {
      if (kind === 'clear') {
        this.abort?.abort();
        clearTimeout(this.timer);
        void this.refresh().catch(() => {});
      }
      if (kind === 'local') {
        if (this.status.connected) this.set({ message: '修改已保存在本机，等待同步' });
        this.schedule();
      }
      if (kind === 'sync') void this.refresh().catch(() => {});
    });
    const wake = () => {
      if (document.visibilityState === 'visible') this.schedule(500);
    };
    const offline = () => this.set({ message: '离线中，修改已保存在本机，联网后同步' });
    const resume = () => this.schedule(500);
    window.addEventListener('ledger-resume', resume);
    window.addEventListener('online', wake);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', wake);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.status.conflicts.length && !this.timer)
        this.schedule(Math.min(300000, 1000 * 2 ** Math.min(this.failures, 8)));
    }, 60000);
    return () => {
      unsubscribe();
      clearTimeout(this.timer);
      clearInterval(interval);
      this.abort?.abort();
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', offline);
      window.removeEventListener('ledger-resume', resume);
      document.removeEventListener('visibilitychange', wake);
    };
  }
}
export const syncClient = new SyncClient(repository);
