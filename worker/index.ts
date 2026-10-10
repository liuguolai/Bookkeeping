// Small structural types keep the Worker independently type checked without a browser runtime shim.
interface Statement {
  bind(...args: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Env {
  DB?: { prepare(sql: string): Statement };
  ASSETS?: { fetch(request: Request): Promise<Response> };
  SYNC_SETUP_CODE?: string;
  SYNC_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  AUTH_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}
const MAX_BYTES = 1_800_256;
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
    },
  });
async function digest(text: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
async function body(request: Request, maxBytes = MAX_BYTES): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new Error('content');
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new Error('large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body');
  return parsed;
}
type Vault = { revision: number; payload: string | null; updated_at: number };
type Login = {
  username: string;
  vault_id: string;
  salt: string;
  verifier: string;
  wrapped_key: string;
  revision: number;
};
function username(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{2,31}$/.test(value);
}
function tokenString(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
async function accountRequest(request: Request, env: Env, path: string): Promise<Response> {
  const publicRoute = path === '/challenge' || path === '/login';
  if (path !== '' && !publicRoute) return json({ error: '接口不存在' }, 404);
  if (publicRoute ? request.method !== 'POST' : !['GET', 'POST', 'PUT'].includes(request.method))
    return json({ error: '不支持此请求方法' }, 405);
  if (!env.DB || !env.AUTH_RATE_LIMIT)
    return json({ error: '账号服务尚未配置，请先升级并绑定登录限流服务；原密钥同步不受影响' }, 503);
  try {
    // Cloudflare supplies this header; never trust a client-selected account as the only limit key.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    if (!(await env.AUTH_RATE_LIMIT.limit({ key: `ip:${ip}` })).success)
      return json({ error: '账号操作过于频繁，请稍后重试' }, 429);
    let input: Record<string, unknown> = {};
    if (request.method !== 'GET') {
      try {
        input = await body(request, 4096);
      } catch {
        return json({ error: '账号请求格式或大小不正确' }, 400);
      }
    }
    if (publicRoute) {
      if (!username(input.username)) return json({ error: '账号格式不正确' }, 400);
      if (
        path === '/login' &&
        !(await env.AUTH_RATE_LIMIT.limit({ key: `login:${input.username}` })).success
      )
        return json({ error: '账号操作过于频繁，请稍后重试' }, 429);
      const row = await env.DB.prepare('SELECT * FROM sync_accounts WHERE username = ?')
        .bind(input.username)
        .first<Login>();
      if (path === '/challenge')
        return json({ salt: row?.salt ?? (await digest(crypto.randomUUID())) });
      if (!tokenString(input.proof) || !tokenString(input.salt))
        return json({ error: '账号或密码不正确' }, 401);
      const candidate = await digest(input.proof);
      // Account existence and password errors share the same login response.
      if (!row || row.salt !== input.salt || !sameHash(row.verifier, candidate))
        return json({ error: '账号或密码不正确' }, 401);
      return json({ vaultId: row.vault_id, salt: row.salt, wrappedKey: row.wrapped_key });
    }
    const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return json({ error: '请先连接同步空间，或使用恢复密钥' }, 401);
    const vaultId = await digest(token);
    if (!(await env.DB.prepare('SELECT id FROM sync_vaults WHERE id = ?').bind(vaultId).first()))
      return json({ error: '同步空间不存在，请检查恢复密钥' }, 401);
    const existing = await env.DB.prepare('SELECT * FROM sync_accounts WHERE vault_id = ?')
      .bind(vaultId)
      .first<Login>();
    if (request.method === 'GET')
      return json({
        account: existing ? { username: existing.username, revision: existing.revision } : null,
      });
    if (
      !username(input.username) ||
      !tokenString(input.salt) ||
      !tokenString(input.proof) ||
      typeof input.wrappedKey !== 'string' ||
      input.wrappedKey.length > 512
    )
      return json({ error: '账号加密信息不正确' }, 400);
    try {
      const wrapped = JSON.parse(input.wrappedKey);
      if (
        wrapped.v !== 1 ||
        typeof wrapped.iv !== 'string' ||
        !/^[A-Za-z0-9_-]{16}$/.test(wrapped.iv) ||
        typeof wrapped.data !== 'string' ||
        !/^[A-Za-z0-9_-]{84}$/.test(wrapped.data)
      )
        throw new Error();
    } catch {
      return json({ error: '只接受受支持的加密密钥' }, 400);
    }
    const verifier = await digest(input.proof);
    if (request.method === 'POST') {
      if (input.revision !== 0 || existing)
        return json({ error: '此空间已绑定账号，请重新打开账号设置' }, 409);
      const result = await env.DB.prepare(
        'INSERT OR IGNORE INTO sync_accounts (username, vault_id, salt, verifier, wrapped_key, revision, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      )
        .bind(input.username, vaultId, input.salt, verifier, input.wrappedKey, Date.now())
        .run();
      if (result.meta.changes !== 1)
        return json({ error: '账号已被使用或空间已绑定，请重新打开账号设置' }, 409);
      return json({ username: input.username, revision: 1 });
    }
    if (
      !existing ||
      existing.username !== input.username ||
      !Number.isSafeInteger(input.revision) ||
      Number(input.revision) < 1 ||
      Number(input.revision) >= Number.MAX_SAFE_INTEGER
    )
      return json({ error: '账号状态已变化，请重新打开账号设置' }, 409);
    const result = await env.DB.prepare(
      'UPDATE sync_accounts SET salt = ?, verifier = ?, wrapped_key = ?, revision = revision + 1, updated_at = ? WHERE vault_id = ? AND revision = ?',
    )
      .bind(input.salt, verifier, input.wrappedKey, Date.now(), vaultId, input.revision)
      .run();
    if (result.meta.changes !== 1)
      return json({ error: '另一台设备刚修改了密码，请重新打开账号设置' }, 409);
    return json({ username: input.username, revision: Number(input.revision) + 1 });
  } catch {
    return json({ error: '账号服务暂不可用，请确认数据库已升级后重试；原同步密钥仍可使用' }, 503);
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/'))
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
      return json({ error: '不允许跨站访问' }, 403);
    if (url.pathname === '/api/sync/v1/account' || url.pathname.startsWith('/api/sync/v1/account/'))
      return accountRequest(request, env, url.pathname.slice('/api/sync/v1/account'.length));
    if (url.pathname === '/api/sync/v1/status' && request.method === 'GET')
      return json({
        enabled: !!env.DB,
        registration: !!env.DB && (env.SYNC_SETUP_CODE?.length ?? 0) >= 16,
      });
    if (url.pathname !== '/api/sync/v1/vault') return json({ error: '接口不存在' }, 404);
    if (!['GET', 'POST', 'PUT'].includes(request.method))
      return json({ error: '不支持此请求方法' }, 405);
    if (!env.DB) return json({ error: '云同步尚未配置，请先完成 D1 数据库绑定' }, 503);
    const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return json({ error: '请使用同步密钥连接' }, 401);
    try {
      const account = await digest(token);
      if (env.SYNC_RATE_LIMIT && !(await env.SYNC_RATE_LIMIT.limit({ key: account })).success)
        return json({ error: '同步过于频繁，请稍后重试' }, 429);
      if (request.method === 'POST') {
        if (
          env.SYNC_RATE_LIMIT &&
          !(await env.SYNC_RATE_LIMIT.limit({ key: 'registration' })).success
        )
          return json({ error: '创建请求过于频繁，请稍后重试' }, 429);
        const setup = request.headers.get('X-Setup-Code') ?? '';
        if (
          !env.SYNC_SETUP_CODE ||
          env.SYNC_SETUP_CODE.length < 16 ||
          setup.length > 200 ||
          (await digest(setup)) !== (await digest(env.SYNC_SETUP_CODE))
        )
          return json({ error: '创建码不正确，或管理员尚未开启创建同步空间' }, 403);
        await env.DB.prepare(
          'INSERT OR IGNORE INTO sync_vaults (id, revision, payload, updated_at) VALUES (?, 0, NULL, ?)',
        )
          .bind(account, Date.now())
          .run();
        return json({ accountId: account }); // Idempotent, including lost registration responses.
      }
      const current = await env.DB.prepare(
        'SELECT revision, payload, updated_at FROM sync_vaults WHERE id = ?',
      )
        .bind(account)
        .first<Vault>();
      if (!current) return json({ error: '同步空间不存在，请检查密钥；本地数据不会清除' }, 401);
      if (request.method === 'GET') return json(current);
      let input: Record<string, unknown>;
      try {
        input = await body(request);
      } catch (e) {
        return json(
          {
            error:
              e instanceof Error && e.message === 'large'
                ? '同步数据超过大小上限'
                : '请求格式不正确',
          },
          e instanceof Error && e.message === 'large' ? 413 : 400,
        );
      }
      if (
        !Number.isSafeInteger(input.revision) ||
        Number(input.revision) < 0 ||
        Number(input.revision) >= Number.MAX_SAFE_INTEGER ||
        typeof input.payload !== 'string' ||
        input.payload.length > 1_800_000
      )
        return json({ error: '同步数据格式或大小不正确' }, 400);
      try {
        const value = JSON.parse(input.payload);
        if (
          value.v !== 1 ||
          !/^[A-Za-z0-9_-]{16}$/.test(value.iv) ||
          typeof value.data !== 'string' ||
          !/^[A-Za-z0-9_-]{22,}$/.test(value.data)
        )
          throw new Error();
      } catch {
        return json({ error: '只接受受支持的加密数据' }, 400);
      }
      const timestamp = Date.now();
      const result = await env.DB.prepare(
        'UPDATE sync_vaults SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
      )
        .bind(input.payload, timestamp, account, input.revision)
        .run();
      if (result.meta.changes !== 1)
        return json({ error: '另一台设备已同步，请重新合并后重试' }, 409);
      return json({ revision: Number(input.revision) + 1, updated_at: timestamp });
    } catch {
      // Never log credentials, encrypted payloads or raw database errors.
      return json({ error: '云服务暂不可用，请稍后重试；本地记账不受影响' }, 503);
    }
  },
};
