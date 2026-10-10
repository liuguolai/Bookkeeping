import { emptyState, validateState, type State } from '../model';
import { bookOverview } from '../bookOverview';

export const collections = [
  'books',
  'categories',
  'payments',
  'entries',
  'budgets',
  'templates',
] as const;
type Collection = (typeof collections)[number];
type Row = Record<string, unknown>;
const orderedCollections = new Set<Collection>(['books', 'categories', 'payments', 'templates']);
export type Choice = 'local' | 'remote';
export type Conflict = { key: string; label: string; local: unknown; remote: unknown };
export class SyncConflict extends Error {
  constructor(public conflicts: Conflict[]) {
    super('有修改冲突，请选择要保留的版本');
  }
}
export function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
// Device preferences, drafts, export history and recovery snapshots stay on this device.
export function cloudState(state: State): State {
  const result = emptyState();
  for (const name of collections) (result[name] as unknown[]) = structuredClone(state[name]);
  for (const name of collections)
    if (!orderedCollections.has(name))
      (result[name] as unknown as Row[]).sort((a, b) =>
        rowKey(name, a).localeCompare(rowKey(name, b)),
      );
  return validateState(result);
}
function rowKey(name: Collection, row: Row) {
  return name === 'budgets'
    ? JSON.stringify([row.bookId, row.month, row.currency])
    : String(row.id);
}
function comparable(name: Collection, value: Row | undefined) {
  if (!value) return undefined;
  // Book timestamps also change when unrelated entries are edited.
  if (name === 'books') {
    const { updatedAt: _, ...rest } = value;
    return rest;
  }
  return value;
}
const labels: Record<Collection, string> = {
  books: '账本',
  entries: '记录',
  categories: '分类',
  payments: '支付方式',
  budgets: '预算',
  templates: '模板',
};
export function mergeStates(
  base: State,
  local: State,
  remote: State,
  choices: Record<string, Choice> = {},
): State {
  const result = cloudState(local),
    conflicts: Conflict[] = [];
  for (const name of collections) {
    const map = (s: State) =>
      new Map((s[name] as unknown as Row[]).map((row) => [rowKey(name, row), row]));
    const b = map(base),
      l = map(local),
      r = map(remote),
      rows: Row[] = [];
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const bv = b.get(id),
        lv = l.get(id),
        rv = r.get(id),
        key = `${name}/${id}`;
      const equal = (a: Row | undefined, c: Row | undefined) =>
        stable(comparable(name, a)) === stable(comparable(name, c));
      let chosen: Row | undefined;
      if (equal(lv, rv)) chosen = lv;
      else if (equal(lv, bv)) chosen = rv;
      else if (equal(rv, bv)) chosen = lv;
      else if (choices[key]) chosen = choices[key] === 'local' ? lv : rv;
      else {
        conflicts.push({
          key,
          label: `${labels[name]} · ${lv?.name ?? rv?.name ?? lv?.note ?? rv?.note ?? id}`,
          local: lv ?? null,
          remote: rv ?? null,
        });
        continue;
      }
      if (chosen)
        rows.push(
          name === 'books'
            ? {
                ...chosen,
                updatedAt: Math.max(Number(lv?.updatedAt ?? 0), Number(rv?.updatedAt ?? 0)),
              }
            : chosen,
        );
    }
    if (orderedCollections.has(name)) {
      const common = new Set([...b.keys()].filter((id) => l.has(id) && r.has(id)));
      const order = (m: Map<string, Row>) => [...m.keys()].filter((id) => common.has(id));
      const bo = order(b),
        lo = order(l),
        ro = order(r),
        key = `${name}/order`;
      let preferred = r;
      if (stable(lo) !== stable(bo) && stable(ro) === stable(bo)) preferred = l;
      else if (
        stable(lo) !== stable(bo) &&
        stable(ro) !== stable(bo) &&
        stable(lo) !== stable(ro)
      ) {
        if (!choices[key])
          conflicts.push({
            key,
            label: `${labels[name]}顺序`,
            local: lo.map((id) => l.get(id)?.name ?? id),
            remote: ro.map((id) => r.get(id)?.name ?? id),
          });
        else preferred = choices[key] === 'local' ? l : r;
      }
      const ranks = new Map(
        [...new Set([...preferred.keys(), ...l.keys(), ...r.keys()])].map((id, index) => [
          id,
          index,
        ]),
      );
      rows.sort((a, b) => ranks.get(rowKey(name, a))! - ranks.get(rowKey(name, b))!);
    }
    (result[name] as unknown as Row[]) = rows;
  }
  if (conflicts.length) throw new SyncConflict(conflicts);
  const bookSlice = (s: State, id: string) =>
    Object.fromEntries(
      collections.map((name) => [
        name,
        (s[name] as unknown as Row[]).filter((r) => (name === 'books' ? r.id : r.bookId) === id),
      ]),
    );
  const concurrentBookDeletion = (id: string) => {
    const b = base.books.find((b) => b.id === id),
      l = local.books.find((b) => b.id === id),
      r = remote.books.find((b) => b.id === id);
    if (!b) return false;
    const content = (s: State) => {
      const slice = bookSlice(s, id);
      slice.books = slice.books.map((row) => comparable('books', row) as Row);
      return stable(slice);
    };
    return (
      ((!l || !!l.deletedAt !== !!b.deletedAt) &&
        content(remote) !== content(base) &&
        content(local) !== content(remote)) ||
      ((!r || !!r.deletedAt !== !!b.deletedAt) &&
        content(local) !== content(base) &&
        content(local) !== content(remote))
    );
  };
  try {
    if (base.books.some((b) => concurrentBookDeletion(b.id))) throw new Error('book deletion');
    return cloudState(result);
  } catch {
    // A delete on one device and a new child/refund on another can violate cross-row
    // invariants even without a row conflict. Require an explicit complete-book choice.
    const ids = new Set([...local.books, ...remote.books].map((b) => b.id));
    const related: Conflict[] = [];
    const selected = emptyState();
    for (const id of ids) {
      const ls = bookSlice(local, id),
        rs = bookSlice(remote, id),
        key = `related/${id}`;
      let slice = bookSlice(result, id);
      const candidate = { ...emptyState(), ...slice };
      try {
        if (concurrentBookDeletion(id)) throw new Error('book deletion');
        validateState(candidate);
      } catch {
        if (!choices[key])
          related.push({
            key,
            label: `关联数据冲突 · ${local.books.find((b) => b.id === id)?.name ?? remote.books.find((b) => b.id === id)?.name}`,
            local: ls,
            remote: rs,
          });
        else slice = choices[key] === 'local' ? ls : rs;
      }
      for (const name of collections) (selected[name] as unknown[]).push(...slice[name]);
    }
    if (related.length) throw new SyncConflict(related);
    // Global limits (e.g. >20 books) cannot safely be solved by dropping records.
    try {
      return cloudState(selected);
    } catch {
      throw new Error('合并后超过账本或记录限制，请先导出备份并整理数据，再重试同步');
    }
  }
}
export function applyCloud(local: State, cloud: State): State {
  const result = {
    ...local,
    ...cloudState(cloud),
    revision: local.revision,
    activeBookId: local.activeBookId,
    drafts: local.drafts,
    backups: local.backups,
    restored: local.restored,
  };
  const books = new Set(result.books.map((b) => b.id));
  result.drafts = result.drafts.filter((d) => books.has(d.bookId));
  if (!result.books.some((b) => b.id === result.activeBookId && !b.deletedAt)) {
    // A fresh device opens a book with records first. Existing device choices stay local.
    const rows = bookOverview(result);
    const latest = rows
      .filter((row) => row.count > 0)
      .sort((a, b) => b.latest.localeCompare(a.latest))[0];
    result.activeBookId = latest?.book.id ?? rows[0]?.book.id ?? null;
  }
  return validateState(result);
}
