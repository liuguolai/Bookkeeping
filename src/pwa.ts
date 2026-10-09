import { useEffect, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
type Status = {
  offline: boolean;
  ready: boolean;
  update: boolean;
  installed: boolean;
  installable: boolean;
  error: string;
  supported: boolean;
};
let status: Status = {
  offline: false,
  ready: false,
  update: false,
  installed: false,
  installable: false,
  error: '',
  supported: false,
};
const listeners = new Set<() => void>();
let started = false,
  registration: ServiceWorkerRegistration | undefined,
  installEvent: InstallEvent | undefined;
let wantsReload = false,
  lastCheck = 0;
function set(value: Partial<Status>) {
  status = { ...status, ...value };
  listeners.forEach((fn) => fn());
}
function message<T>(worker: ServiceWorker, value: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('操作超时，请保持当前页面并稍后重试'));
    }, 12000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage(value, [channel.port2]);
  });
}
async function offlineStatus() {
  if (!registration?.active) return;
  try {
    const result = await message<{ ready: boolean }>(registration.active, {
      type: 'OFFLINE_STATUS',
    });
    set({ ready: result.ready });
  } catch {
    set({ ready: false });
  }
}
const observedRegistrations = new WeakSet<ServiceWorkerRegistration>();
async function registerWorker() {
  const reg = await navigator.serviceWorker.register(
    new URL('sw.js', new URL(import.meta.env.BASE_URL, location.href)),
    { updateViaCache: 'none' },
  );
  registration = reg;
  set({ update: !!reg.active && !!reg.waiting, error: '' });
  if (!observedRegistrations.has(reg)) {
    observedRegistrations.add(reg);
    const observe = () => {
      const worker = reg.installing;
      if (!worker) return;
      const changed = () => {
        if (worker.state === 'installed') set({ update: !!reg.active && !!reg.waiting });
        if (worker.state === 'redundant')
          set({ update: !!reg.waiting, error: '离线文件准备失败；已有账目保留，请联网重新检查。' });
        if (worker.state === 'activated') {
          set({ update: !!reg.waiting, error: '' });
          void offlineStatus();
        }
      };
      worker.addEventListener('statechange', changed);
      changed();
    };
    reg.addEventListener('updatefound', observe);
    observe();
  }
  void navigator.serviceWorker.ready.then(() => offlineStatus());
}
export async function checkPwaUpdate() {
  if (!status.supported) throw new Error(status.error || '离线功能尚未就绪，请联网重新打开');
  if (!navigator.onLine) throw new Error('当前离线，联网后再检查更新');
  // A failed first install can leave a detached registration that cannot update.
  if (!registration || (!registration.active && !registration.waiting && !registration.installing))
    await registerWorker();
  else await registration.update();
  lastCheck = Date.now();
  set({ update: !!registration?.active && !!registration?.waiting });
  await offlineStatus();
}
export async function activatePwaUpdate() {
  if (!registration?.waiting) throw new Error('暂无已下载的更新');
  wantsReload = true;
  try {
    const reply = await message<{ activated: boolean; reason?: string }>(registration.waiting, {
      type: 'ACTIVATE_IF_ALONE',
    });
    if (!reply.activated) {
      wantsReload = false;
      throw new Error(reply.reason);
    }
  } catch (e) {
    wantsReload = false;
    throw e;
  }
}
export async function installPwa() {
  if (!installEvent) return;
  const event = installEvent;
  installEvent = undefined;
  set({ installable: false });
  await event.prompt();
  await event.userChoice;
}
function start() {
  if (started || Capacitor.isNativePlatform()) return;
  started = true;
  const media = matchMedia('(display-mode: standalone)');
  const installed = () =>
    set({
      installed: media.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
    });
  installed();
  media.addEventListener('change', installed);
  const network = () => set({ offline: !navigator.onLine });
  network();
  window.addEventListener('online', network);
  window.addEventListener('offline', network);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event as InstallEvent;
    set({ installable: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = undefined;
    set({ installed: true, installable: false });
  });
  if (!import.meta.env.PROD) {
    set({ error: '开发预览不启用离线缓存；请使用 PWA 生产预览或正式 HTTPS 网址。' });
    return;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    set({ error: '当前浏览器或网址不支持离线安装，请使用 Safari/Chrome 打开 HTTPS 网址。' });
    return;
  }
  set({ supported: true });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wantsReload) location.reload();
    else void offlineStatus();
  });
  void registerWorker().catch(() =>
    set({ error: '离线准备失败，请确认网络、存储空间和 HTTPS 配置后重试。' }),
  );
  window.addEventListener('focus', () => {
    void offlineStatus();
    if (navigator.onLine && Date.now() - lastCheck > 60000) void checkPwaUpdate().catch(() => {});
  });
}
export function usePwa() {
  const value = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => status,
  );
  useEffect(start, []);
  return value;
}
