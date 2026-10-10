import { t } from '../i18n';
import { validateState, type State } from '../model';
import { cloudState } from './merge';

export const MAX_ENVELOPE_BYTES = 1_800_000;
const encoder = new TextEncoder();
const prefix = 'pl1_';
function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
export const newSyncKey = () => prefix + encode(crypto.getRandomValues(new Uint8Array(32)));
export async function credentials(secret: string) {
  secret = secret.trim();
  if (
    !/^pl1_[A-Za-z0-9_-]{43}$/.test(secret) ||
    encode(decode(secret.slice(4))) !== secret.slice(4)
  )
    throw new Error(t('同步密钥格式不正确，请完整粘贴以 pl1_ 开头的密钥'));
  const material = await crypto.subtle.importKey('raw', decode(secret.slice(4)), 'HKDF', false, [
    'deriveBits',
  ]);
  const derive = async (purpose: string) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode('PocketLedger sync v1'),
          info: encoder.encode(purpose),
        },
        material,
        256,
      ),
    );
  const token = encode(await derive('authentication'));
  const accountId = encode(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))),
  );
  const key = await crypto.subtle.importKey('raw', await derive('encryption'), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { token, accountId, key, secret };
}
export async function encryptState(state: State, secret: string): Promise<string> {
  const { key, accountId } = await credentials(secret),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(cloudState(state)));
  if (bytes.length > 1_340_000)
    throw new Error(t('云同步数据超过当前 1.3 MB 上限，本地记账不受影响，请先导出备份'));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`PocketLedger sync v1/${accountId}`) },
    key,
    bytes,
  );
  const envelope = JSON.stringify({
    v: 1,
    iv: encode(iv),
    data: encode(new Uint8Array(ciphertext)),
  });
  if (envelope.length > MAX_ENVELOPE_BYTES) throw new Error(t('云同步数据过大，请先导出备份'));
  return envelope;
}
export async function decryptState(envelope: string, secret: string): Promise<State> {
  try {
    if (envelope.length > MAX_ENVELOPE_BYTES) throw new Error();
    const parsed = JSON.parse(envelope),
      { key, accountId } = await credentials(secret);
    if (
      parsed.v !== 1 ||
      typeof parsed.iv !== 'string' ||
      parsed.iv.length !== 16 ||
      typeof parsed.data !== 'string'
    )
      throw new Error();
    const bytes = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decode(parsed.iv),
        additionalData: encoder.encode(`PocketLedger sync v1/${accountId}`),
      },
      key,
      decode(parsed.data),
    );
    return cloudState(validateState(JSON.parse(new TextDecoder().decode(bytes))));
  } catch {
    throw new Error(t('云端数据无法解密或版本不支持；本地数据保留，请检查同步密钥或更新应用'));
  }
}
