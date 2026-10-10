import { useMemo, useState, useSyncExternalStore } from 'react';
import { useLedger } from './context';
import { syncClient, syncSupported } from './sync/client';
import { newSyncKey } from './sync/crypto';
import type { Choice } from './sync/merge';
import { Dialog, Label, Icon } from './ui';
import { money, currencyCodes, type Currency } from './money';
import type { State } from './model';
import { bookOverview } from './bookOverview';
import { AccountAccess } from './AccountAccess';
import { isNative } from './storage';
import { NATIVE_SYNC_ORIGIN } from './sync/transport';

function VersionContent({ value, state }: { value: unknown; state: State }) {
  if (value === null) return <p>已永久删除</p>;
  if (Array.isArray(value))
    return (
      <ol>
        {value.map((item, i) => (
          <li key={i}>
            <VersionContent value={item} state={state} />
          </li>
        ))}
      </ol>
    );
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  const row = value as Record<string, unknown>;
  const collectionNames: Record<string, string> = {
    books: '账本',
    entries: '记录',
    categories: '分类',
    payments: '支付方式',
    budgets: '预算',
    templates: '模板',
  };
  if (Array.isArray(row.books))
    return (
      <div>
        {Object.entries(collectionNames).map(([key, label]) => (
          <details key={key}>
            <summary>
              {label}（{(row[key] as unknown[]).length}）
            </summary>
            <VersionContent value={row[key]} state={state} />
          </details>
        ))}
      </div>
    );
  const currency = currencyCodes.includes(row.currency as Currency)
    ? (row.currency as Currency)
    : undefined;
  const lines = [
    row.name && `名称：${row.name}`,
    row.type &&
      `类型：${({ expense: '支出', income: '收入', refund: '退款' } as Record<string, string>)[String(row.type)] ?? row.type}`,
    typeof row.amount === 'number' && currency && `金额：${money(row.amount, currency)}`,
    row.occurredAt && `发生时间：${String(row.occurredAt).replace('T', ' ')}`,
    row.month && `月份：${row.month}`,
    'note' in row && `备注：${row.note || '未填写'}`,
    row.categoryId &&
      `分类：${state.categories.find((c) => c.id === row.categoryId)?.name ?? '另一设备的分类'}`,
    'paymentId' in row &&
      `支付方式：${state.payments.find((p) => p.id === row.paymentId)?.name ?? '未填写或另一设备的支付方式'}`,
    row.currency && !row.amount && `币种：${row.currency}`,
    Array.isArray(row.common) && `常用币种：${row.common.join('、')}`,
    row.timezone && `时区：${row.timezone}`,
    typeof row.active === 'boolean' && `状态：${row.active ? '启用' : '停用'}`,
    typeof row.archived === 'boolean' && `归档：${row.archived ? '是' : '否'}`,
    'icon' in row && `图标：${row.icon}`,
    'pinned' in row && `置顶：${row.pinned ? '是' : '否'}`,
    'updatedAt' in row && `修改时间：${new Date(Number(row.updatedAt)).toLocaleString('zh-CN')}`,
    'createdAt' in row && `删除状态：${row.deletedAt ? '已移入回收站' : '正常'}`,
  ].filter((line): line is string => typeof line === 'string');
  return (
    <div>
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {!!row.categories &&
        typeof row.categories === 'object' &&
        !Array.isArray(row.categories) &&
        currency && (
          <ul>
            {Object.entries(row.categories).map(([id, amount]) => (
              <li key={id}>
                {state.categories.find((c) => c.id === id)?.name ?? '另一设备分类'}：
                {money(Number(amount), currency)}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function SyncPanel({
  onboarding = false,
  onOpenBooks,
}: {
  onboarding?: boolean;
  onOpenBooks?: () => void;
}) {
  const status = useSyncExternalStore(syncClient.subscribe, syncClient.snapshot);
  const { confirm, notify, state } = useLedger();
  const [mode, setMode] = useState<'create' | 'join' | 'key' | null>(null);
  const [key, setKey] = useState(''),
    [setup, setSetup] = useState(''),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState(''),
    [choices, setChoices] = useState<Record<string, Choice>>({});
  const [choiceRevision, setChoiceRevision] = useState('');
  const revision = `${status.localRevision}/${status.remoteRevision}`;
  const currentChoices = choiceRevision === revision ? choices : {};
  const overview = useMemo(() => bookOverview(state), [state]);
  const active = overview.find((row) => row.book.id === state.activeBookId);
  const othersWithRecords = overview.filter(
    (row) => row.book.id !== active?.book.id && row.count > 0,
  );
  const localPreview = !isNative && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!syncSupported)
    return (
      <section className="card sync-panel">
        <h2>云同步</h2>
        <p>此平台暂未接入云同步，可继续使用本地加密存储和文件备份。</p>
      </section>
    );
  const close = () => {
    if (!status.busy) {
      setMode(null);
      setKey('');
      setSetup('');
      setError('');
      setSaved(false);
    }
  };
  return (
    <section className="card sync-panel" aria-label="云同步">
      <div className="section-heading">
        <h2>
          <Icon name="shield" size={20} /> {onboarding ? '已有云端账本？' : '云同步'}
        </h2>
        <span className="subtle">可选 · 加密上传</span>
      </div>
      <p role="status">{status.message}</p>
      {isNative && (
        <p className="subtle">与网页版共用账号和账本：{new URL(NATIVE_SYNC_ORIGIN).hostname}</p>
      )}
      {onboarding && <p>换手机或在另一台设备使用，请先连接已有空间。无需先创建空账本。</p>}
      {localPreview && (
        <p className="sync-notice">
          本地测试环境：这里的同步不会上传到正式网站。多设备使用请打开同一个正式网址。
        </p>
      )}
      {status.accountId && (
        <p className="subtle">
          同步空间 {status.accountId.slice(0, 12)}
          {status.syncedAt > 0 &&
            ` · 最近同步 ${new Date(status.syncedAt).toLocaleString('zh-CN')}`}
        </p>
      )}
      {status.summary && (
        <p className="sync-summary">
          最近成功同步：{status.summary.books} 个账本 · {status.summary.entries}{' '}
          笔记录（不含回收站）
        </p>
      )}
      {status.connected && active && active.count === 0 && othersWithRecords.length > 0 && (
        <p className="sync-notice">
          当前“{active.book.name}”没有记录，另外 {othersWithRecords.length}{' '}
          个账本有记录。请查看全部账本并切换；同名账本也会分别保留。
        </p>
      )}
      <p className="subtle">
        开启后同步所有账本、记录、分类、支付方式、预算和模板。草稿和文件备份记录仅保留在本机。断网可继续记账。
      </p>
      <div className="sync-actions">
        <AccountAccess connected={status.connected} disabled={status.busy} />
        {onOpenBooks && status.accountId && (
          <button className="secondary" onClick={onOpenBooks}>
            查看全部账本
          </button>
        )}
        {status.connected ? (
          <>
            <button
              className="primary"
              disabled={status.busy}
              onClick={() => void syncClient.sync()}
            >
              立即同步
            </button>
            <button
              className="secondary"
              disabled={status.busy}
              onClick={async () => {
                try {
                  setKey(await syncClient.savedKey());
                  setMode('key');
                } catch {
                  notify('同步配置暂时无法读取，请重试');
                }
              }}
            >
              查看同步密钥
            </button>
            <button
              className="secondary"
              disabled={status.busy}
              onClick={async () => {
                if (
                  await confirm(
                    '断开这台设备？',
                    '本机和云端数据都保留。重新连接时可使用已绑定的账号密码或原同步密钥。请先保存恢复密钥；未同步修改会留在本机。',
                    false,
                    '断开同步',
                  )
                ) {
                  try {
                    await syncClient.disconnect();
                  } catch {
                    notify('断开失败，请重试');
                  }
                }
              }}
            >
              断开同步
            </button>
          </>
        ) : (
          <>
            {!status.accountId && !onboarding && (
              <button
                className="primary"
                disabled={status.busy}
                onClick={() => {
                  setKey(newSyncKey());
                  setMode('create');
                }}
              >
                创建同步空间
              </button>
            )}
            <button
              className="secondary"
              disabled={status.busy}
              onClick={() => {
                setKey('');
                setMode('join');
              }}
            >
              使用已有密钥连接
            </button>
          </>
        )}
      </div>
      <details className="sync-help">
        <summary>如何在另一台设备继续记账？</summary>
        <p>
          两台设备打开同一个网站。已绑定账号时选择“账号登录”；老用户也可使用已有密钥连接。核对两端同步空间编号相同，再查看全部账本。
        </p>
        <p>
          首次使用先创建同步空间，再到“账号与密码”绑定账号。创建码只用于新建空间，不是登录密码。原同步密钥也是恢复密钥，用于解密和重置密码，请保存在密码管理器，不要发给他人。
        </p>
      </details>
      {status.conflicts.length > 0 && (
        <div className="sync-conflicts">
          <h3>有 {status.conflicts.length} 项修改需要确认</h3>
          <p>
            两端原始数据暂时保留。选择每项要保留的版本后再同步；关联数据冲突会按整个账本选择。同步前会自动保存本机保护副本。
          </p>
          {status.conflicts.map((conflict) => (
            <fieldset key={conflict.key}>
              <legend>{conflict.label}</legend>
              <div className="sync-versions">
                {(['local', 'remote'] as const).map((side) => (
                  <div key={side}>
                    <label>
                      <input
                        type="radio"
                        name={conflict.key}
                        checked={currentChoices[conflict.key] === side}
                        onChange={() => {
                          setChoices({ ...currentChoices, [conflict.key]: side });
                          setChoiceRevision(revision);
                        }}
                      />
                      保留{side === 'local' ? '本机' : '云端'}版本
                    </label>
                    <details>
                      <summary>查看内容</summary>
                      <div className="sync-version-content">
                        <VersionContent value={conflict[side]} state={state} />
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          <button
            className="primary"
            disabled={status.busy || status.conflicts.some((c) => !currentChoices[c.key])}
            onClick={() =>
              void syncClient.sync({
                localRevision: status.localRevision,
                remoteRevision: status.remoteRevision,
                choices: currentChoices,
              })
            }
          >
            确认选择并同步
          </button>
        </div>
      )}
      {mode && (
        <Dialog
          title={mode === 'create' ? '创建同步空间' : mode === 'join' ? '连接同步空间' : '同步密钥'}
          onClose={close}
          compact
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError('');
              try {
                await syncClient.connect(key, mode === 'create' ? setup : undefined);
                close();
              } catch (e) {
                setError(e instanceof Error ? e.message : '连接失败，请重试');
              }
            }}
          >
            <p className="dialog-copy">
              同步密钥就是登录凭证，也用于解密账目。请保存到密码管理器，不要发给别人。密钥遗失且所有设备都已退出后，无法找回云端账目。
            </p>
            <Label title="同步密钥">
              <textarea
                className="sync-key"
                aria-label="同步密钥"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                readOnly={mode !== 'join'}
                autoComplete="off"
                spellCheck={false}
                maxLength={100}
                required
              />
            </Label>
            {mode !== 'join' && (
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(key);
                    notify('密钥已复制，请保存到安全位置');
                  } catch {
                    setError('无法自动复制，请手动选择并复制密钥');
                  }
                }}
              >
                复制同步密钥
              </button>
            )}
            {mode === 'create' && (
              <>
                <Label title="管理员提供的创建码">
                  <input
                    aria-label="创建码"
                    type="password"
                    autoComplete="off"
                    value={setup}
                    onChange={(e) => setSetup(e.target.value)}
                    maxLength={200}
                    required
                  />
                </Label>
                <p className="subtle">
                  创建码由网站管理员配置，只在创建时使用。连接已有空间不需要创建码。
                </p>
                <label className="sync-check">
                  <input
                    type="checkbox"
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                  />
                  我已安全保存同步密钥
                </label>
              </>
            )}
            {mode !== 'key' && (
              <p className="dialog-copy">
                连接后，会将本机所有账本与此空间合并并开启自动同步。已有记录不会整库覆盖；冲突会提示你处理。
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {mode !== 'key' && (
              <button
                className="primary wide"
                disabled={status.busy || (mode === 'create' && !saved)}
              >
                {status.busy ? '连接中…' : '连接并开启同步'}
              </button>
            )}
          </form>
        </Dialog>
      )}
    </section>
  );
}

export function SyncStatusButton({ onOpen }: { onOpen: () => void }) {
  const status = useSyncExternalStore(syncClient.subscribe, syncClient.snapshot);
  if (!syncSupported || !status.accountId) return null;
  return (
    <button className="sync-status-button" onClick={onOpen} aria-label="查看云同步状态">
      <Icon name={status.conflicts.length ? 'info' : 'shield'} size={14} />
      {status.connected ? status.message : '云同步已断开'}
    </button>
  );
}
