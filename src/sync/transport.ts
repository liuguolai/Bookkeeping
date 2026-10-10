import { t } from '../i18n';
import { Capacitor, CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core';

// Public service origin only. Never put credentials or recovery keys in build configuration.
export const NATIVE_SYNC_ORIGIN = 'https://pocket-ledger.liuguolai.workers.dev';
export const syncSupported = !Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android';

export function nativeSyncUrl(path: string, origin = NATIVE_SYNC_ORIGIN) {
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !/^\/api\/sync\/v1\/(vault|account(?:\/(?:challenge|login))?)$/.test(path)
  )
    throw new Error(t('同步服务地址无效，请更新应用'));
  return new URL(path, base).href;
}

export function createSyncRequest(
  native: boolean,
  http: (options: HttpOptions) => Promise<HttpResponse> = (options) =>
    CapacitorHttp.request(options),
  browser: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return async (input, options = {}) => {
    if (!native) return browser(input, options);
    const url = nativeSyncUrl(String(input));
    const signal = options.signal;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const headers = Object.fromEntries(new Headers(options.headers));
    // Explicit native API, without globally patching fetch or enabling arbitrary WebView navigation.
    // Redirects are disabled to keep authentication credentials on the configured service.
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      http({
        url,
        method: options.method ?? 'GET',
        headers,
        data: options.body ? JSON.parse(String(options.body)) : undefined,
        responseType: 'text',
        connectTimeout: 20000,
        readTimeout: 20000,
        disableRedirects: true,
      })
        .then((result) => {
          if (signal?.aborted) return;
          if (result.status >= 300 && result.status < 400)
            throw new TypeError(t('同步服务发生重定向，请更新应用'));
          resolve(
            new Response(
              [204, 205, 304].includes(result.status)
                ? null
                : typeof result.data === 'string'
                  ? result.data
                  : JSON.stringify(result.data),
              { status: result.status, headers: result.headers },
            ),
          );
        })
        .catch(() => reject(new TypeError(t('连接中断或超时，请稍后重试'))))
        .finally(() => signal?.removeEventListener('abort', abort));
    });
  };
}

export const syncRequest = createSyncRequest(Capacitor.isNativePlatform());
