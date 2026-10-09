import { z } from 'zod';
import { CURRENCIES, currencyCodes, amountText } from './money';
import { type State, type Entry, emptyState, validateState, uid } from './model';

const encoder = new TextEncoder();
const CONTEXT = encoder.encode('PocketLedger backup v1');
const ITERATIONS = 310000;
const envelopeSchema = z
  .object({
    format: z.literal('pocket-ledger'),
    version: z.literal(1),
    algorithm: z.literal('AES-GCM/PBKDF2-SHA256'),
    iterations: z.literal(ITERATIONS),
    salt: z.string().max(32),
    iv: z.string().max(24),
    ciphertext: z.string().min(20).max(34000000),
  })
  .strict();
export const MAX_BACKUP_SIZE = 25 * 1024 * 1024;
function b64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function unb64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export function snapshot(s: State, bookIds: string[]): State {
  const selected = new Set(bookIds);
  const books = s.books.filter((b) => selected.has(b.id) && !b.deletedAt);
  if (!books.length) throw new Error('没有可备份的账本');
  const allowed = new Set(books.map((b) => b.id));
  return validateState({
    ...emptyState(),
    books,
    activeBookId: books[0].id,
    categories: s.categories.filter((c) => allowed.has(c.bookId)),
    payments: s.payments.filter((p) => allowed.has(p.bookId)),
    entries: s.entries.filter((e) => allowed.has(e.bookId) && !e.deletedAt),
    budgets: s.budgets.filter((b) => allowed.has(b.bookId)),
    templates: s.templates.filter((t) => allowed.has(t.bookId)),
  });
}
export async function encryptBackup(
  s: State,
  bookIds: string[],
  password: string,
): Promise<string> {
  if (password.length < 8 || password.length > 200) throw new Error('备份密码需要 8 至 200 个字符');
  const data = {
    formatVersion: 1,
    createdAt: Date.now(),
    currencies: Object.fromEntries(currencyCodes.map((c) => [c, CURRENCIES[c].precision])),
    state: snapshot(s, bookIds),
  };
  const plaintext = encoder.encode(JSON.stringify(data));
  if (plaintext.byteLength > MAX_BACKUP_SIZE * 0.7) throw new Error('备份过大，请按账本分别导出');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: CONTEXT },
    await key(password, salt),
    plaintext,
  );
  return JSON.stringify({
    format: 'pocket-ledger',
    version: 1,
    algorithm: 'AES-GCM/PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(new Uint8Array(ciphertext)),
  });
}
export interface BackupPreview {
  state: State;
  createdAt: number;
  fingerprint: string;
}
export async function decryptBackup(text: string, password: string): Promise<BackupPreview> {
  if (text.length > MAX_BACKUP_SIZE) throw new Error('备份文件超过 25 MB');
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(text));
  } catch {
    throw new Error('文件格式或版本不支持，请选择口袋账本加密备份');
  }
  let bytes: ArrayBuffer;
  try {
    const salt = unb64(envelope.salt),
      iv = unb64(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encryption parameters');
    bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: CONTEXT },
      await key(password, salt),
      unb64(envelope.ciphertext),
    );
  } catch {
    throw new Error('密码错误或备份文件已损坏');
  }
  let payload: { createdAt: number; state: State };
  try {
    const raw = z
      .object({
        formatVersion: z.literal(1),
        createdAt: z.number().int().nonnegative(),
        currencies: z.record(z.string(), z.number().int()),
        state: z.unknown(),
      })
      .parse(JSON.parse(new TextDecoder().decode(bytes)));
    for (const [code, precision] of Object.entries(raw.currencies))
      if (
        !(code in CURRENCIES) ||
        CURRENCIES[code as keyof typeof CURRENCIES].precision !== precision
      )
        throw new Error('Unknown precision');
    const state = validateState(raw.state);
    for (const e of [...state.entries, ...state.templates, ...state.budgets, ...state.books])
      if (raw.currencies[e.currency] === undefined) throw new Error('Missing currency');
    if (
      state.entries.some((e) => e.deletedAt) ||
      state.books.some((b) => b.deletedAt) ||
      state.drafts.length
    )
      throw new Error('Unexpected deleted data');
    payload = { createdAt: raw.createdAt, state };
  } catch {
    throw new Error('备份内容校验失败：币种、金额、日期或关联关系不合法');
  }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return {
    ...payload,
    fingerprint: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
      '',
    ),
  };
}
export function restoreBackup(target: State, preview: BackupPreview, allowDuplicate = false) {
  if (target.restored.includes(preview.fingerprint) && !allowDuplicate)
    throw new Error('这份备份已经恢复过，请明确确认是否另建副本');
  const src = validateState(preview.state);
  if (target.books.length + src.books.length > 20)
    throw new Error('恢复后将超过 20 个账本，请先整理账本');
  const bookMap = new Map(src.books.map((b) => [b.id, uid()]));
  const catMap = new Map(src.categories.map((c) => [c.id, uid()]));
  const paymentMap = new Map(src.payments.map((p) => [p.id, uid()]));
  const entryMap = new Map(src.entries.map((e) => [e.id, uid()]));
  for (const b of src.books) {
    let name = b.name,
      n = 1;
    while (target.books.some((other) => other.name === name))
      name = `${b.name.slice(0, 12)}·副本${n++}`;
    target.books.push({ ...b, id: bookMap.get(b.id)!, name, updatedAt: Date.now() });
  }
  target.categories.push(
    ...src.categories.map((c) => ({ ...c, id: catMap.get(c.id)!, bookId: bookMap.get(c.bookId)! })),
  );
  target.payments.push(
    ...src.payments.map((p) => ({
      ...p,
      id: paymentMap.get(p.id)!,
      bookId: bookMap.get(p.bookId)!,
    })),
  );
  target.entries.push(
    ...src.entries.map((e) => ({
      ...e,
      id: entryMap.get(e.id)!,
      bookId: bookMap.get(e.bookId)!,
      categoryId: catMap.get(e.categoryId)!,
      paymentId: e.paymentId ? paymentMap.get(e.paymentId) : undefined,
      originalId: e.originalId ? entryMap.get(e.originalId) : undefined,
    })),
  );
  target.budgets.push(
    ...src.budgets.map((b) => ({
      ...b,
      bookId: bookMap.get(b.bookId)!,
      categories: Object.fromEntries(
        Object.entries(b.categories).map(([id, amount]) => [catMap.get(id)!, amount]),
      ),
    })),
  );
  target.templates.push(
    ...src.templates.map((t) => ({
      ...t,
      id: uid(),
      bookId: bookMap.get(t.bookId)!,
      categoryId: catMap.get(t.categoryId)!,
      paymentId: t.paymentId ? paymentMap.get(t.paymentId) : undefined,
    })),
  );
  target.activeBookId = bookMap.get(src.books[0]?.id) ?? target.activeBookId;
  target.restored = Array.from(new Set([...target.restored, preview.fingerprint]));
}
function csvCell(text: string): string {
  const value = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + value.replace(/"/g, '""') + '"';
}
export function exportCsv(s: State, entries: Entry[]): string {
  const rows = [
    [
      '流水标识',
      '账本',
      '类型',
      '发生时间',
      '时区',
      '金额',
      '币种',
      '分类',
      '支付方式',
      '备注',
      '原支出标识',
    ],
  ];
  for (const e of entries.filter((e) => !e.deletedAt))
    rows.push([
      e.id,
      s.books.find((b) => b.id === e.bookId)?.name ?? '',
      { expense: '支出', income: '收入', refund: '退款' }[e.type],
      e.occurredAt,
      s.books.find((b) => b.id === e.bookId)?.timezone ?? '',
      amountText(e.amount, e.currency),
      e.currency,
      s.categories.find((c) => c.id === e.categoryId)?.name ?? '',
      s.payments.find((p) => p.id === e.paymentId)?.name ?? '',
      e.note,
      e.originalId ?? '',
    ]);
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
