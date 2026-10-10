import { credentials } from './crypto';
import { syncRequest } from './transport';

const encoder = new TextEncoder();
const ITERATIONS = 600_000;
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
export function normalizeUsername(value: string) {
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name))
    throw new Error('账号请使用 3–32 位英文字母、数字、下划线或短横线，以字母或数字开头');
  return name;
}
export function validatePassword(password: string) {
  if ([...password].length < 8 || password.length > 128)
    throw new Error('密码需要 8–128 个字符；请勿重复使用其他网站的密码');
}
export const newAccountSalt = () => encode(crypto.getRandomValues(new Uint8Array(32)));
async function derive(password: string, salt: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(salt) || encode(decode(salt)) !== salt)
    throw new Error('账号加密参数无效，请更新应用后重试');
  validatePassword(password);
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const stretched = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations: ITERATIONS },
    material,
    256,
  );
  const root = await crypto.subtle.importKey('raw', stretched, 'HKDF', false, ['deriveBits']);
  const bits = (purpose: string) =>
    crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode('PocketLedger login v1'),
        info: encoder.encode(purpose),
      },
      root,
      256,
    );
  const proof = encode(new Uint8Array(await bits('authentication')));
  const key = await crypto.subtle.importKey('raw', await bits('key wrapping'), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { proof, key };
}
function aad(username: string, vaultId: string, salt: string) {
  return encoder.encode(`PocketLedger login v1/${username}/${vaultId}/${salt}`);
}
export async function wrapSyncKey(username: string, password: string, secret: string) {
  username = normalizeUsername(username);
  const identity = await credentials(secret),
    salt = newAccountSalt(),
    { proof, key } = await derive(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(username, identity.accountId, salt) },
    key,
    encoder.encode(identity.secret),
  );
  return {
    username,
    salt,
    proof,
    wrappedKey: JSON.stringify({ v: 1, iv: encode(iv), data: encode(new Uint8Array(data)) }),
  };
}
export type AccountInfo = { username: string; revision: number };
export class AccountClient {
  constructor(private request: typeof fetch = syncRequest) {}
  private async api(path: string, method: string, input?: object, secret?: string) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.request(`/api/sync/v1/account${path}`, {
        method,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...(input ? { 'Content-Type': 'application/json' } : {}),
          ...(secret ? { Authorization: `Bearer ${(await credentials(secret)).token}` } : {}),
        },
        body: input ? JSON.stringify(input) : undefined,
      });
      if (!response.headers.get('Content-Type')?.includes('application/json'))
        throw new Error('网站尚未部署账号服务，请联系管理员升级');
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? '账号操作失败，请稍后重试');
      return value;
    } catch (error) {
      if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError'))
        throw new Error(
          '连接中断或超时。若正在设置密码，请重新打开账号设置确认结果；原同步密钥仍可使用',
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async current(secret: string): Promise<AccountInfo | null> {
    const data = await this.api('', 'GET', undefined, secret);
    if (data.account === null) return null;
    if (
      !data.account ||
      normalizeUsername(data.account.username) !== data.account.username ||
      !Number.isSafeInteger(data.account.revision) ||
      data.account.revision < 1
    )
      throw new Error('账号信息无效，请更新应用');
    return data.account;
  }
  async bind(secret: string, username: string, password: string, revision = 0) {
    const wrapped = await wrapSyncKey(username, password, secret);
    return this.api('', revision ? 'PUT' : 'POST', { ...wrapped, revision }, secret);
  }
  async login(username: string, password: string): Promise<string> {
    username = normalizeUsername(username);
    validatePassword(password);
    const challenge = await this.api('/challenge', 'POST', { username });
    const { proof, key } = await derive(password, challenge.salt);
    const data = await this.api('/login', 'POST', { username, proof, salt: challenge.salt });
    try {
      if (
        data.salt !== challenge.salt ||
        typeof data.vaultId !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(data.vaultId) ||
        typeof data.wrappedKey !== 'string' ||
        data.wrappedKey.length > 512
      )
        throw new Error();
      const envelope = JSON.parse(data.wrappedKey);
      if (
        envelope.v !== 1 ||
        !/^[A-Za-z0-9_-]{16}$/.test(envelope.iv) ||
        !/^[A-Za-z0-9_-]{84}$/.test(envelope.data)
      )
        throw new Error();
      const bytes = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: decode(envelope.iv),
          additionalData: aad(username, data.vaultId, data.salt),
        },
        key,
        decode(envelope.data),
      );
      const identity = await credentials(new TextDecoder().decode(bytes));
      if (identity.accountId !== data.vaultId) throw new Error();
      return identity.secret;
    } catch {
      throw new Error('账号密钥无法解锁，请使用恢复密钥连接后重新设置密码；本地账目保留');
    }
  }
  async recover(secret: string, password: string) {
    const account = await this.current(secret);
    if (!account) throw new Error('此空间尚未绑定账号，请先使用同步密钥连接，再设置账号密码');
    await this.bind(secret, account.username, password, account.revision);
    return account.username;
  }
}
export const accountClient = new AccountClient();
