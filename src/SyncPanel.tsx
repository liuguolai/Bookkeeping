import { t, useLocale, getLocale } from './i18n';
import { messageText } from './i18n';
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
  useLocale();
  if (value === null) return <p>{t('已永久删除')}</p>;
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
    books: t('账本'),
    entries: t('记录'),
    categories: t('分类'),
    payments: t('支付方式'),
    budgets: t('预算'),
    templates: t('模板'),
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
    row.name && t('名称：{0}', [row.name]),
    row.type &&
      t('类型：{0}', [
        ({ expense: t('支出'), income: t('收入'), refund: t('退款') } as Record<string, string>)[
          String(row.type)
        ] ?? row.type,
      ]),
    typeof row.amount === 'number' && currency && t('金额：{0}', [money(row.amount, currency)]),
    row.occurredAt && t('发生时间：{0}', [String(row.occurredAt).replace('T', ' ')]),
    row.month && t('月份：{0}', [row.month]),
    'note' in row && t('备注：{0}', [row.note || t('未填写')]),
    row.categoryId &&
      t('分类：{0}', [
        state.categories.find((c) => c.id === row.categoryId)?.name ?? t('另一设备的分类'),
      ]),
    'paymentId' in row &&
      t('支付方式：{0}', [
        state.payments.find((p) => p.id === row.paymentId)?.name ?? t('未填写或另一设备的支付方式'),
      ]),
    row.currency && !row.amount && t('币种：{0}', [row.currency]),
    Array.isArray(row.common) && t('常用币种：{0}', [row.common.join('、')]),
    row.timezone && t('时区：{0}', [row.timezone]),
    typeof row.active === 'boolean' && t('状态：{0}', [row.active ? t('启用') : t('停用')]),
    typeof row.archived === 'boolean' && t('归档：{0}', [row.archived ? t('是') : t('否')]),
    'icon' in row && t('图标：{0}', [row.icon]),
    'pinned' in row && t('置顶：{0}', [row.pinned ? t('是') : t('否')]),
    'updatedAt' in row &&
      t('修改时间：{0}', [new Date(Number(row.updatedAt)).toLocaleString(getLocale())]),
    'createdAt' in row && t('删除状态：{0}', [row.deletedAt ? t('已移入回收站') : t('正常')]),
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
                {state.categories.find((c) => c.id === id)?.name ?? t('另一设备分类')}：
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
  useLocale();
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
        <h2>{t('云同步')}</h2>
        <p>{t('此平台暂未接入云同步，可继续使用本地加密存储和文件备份。')}</p>
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
    <section className="card sync-panel" aria-label={t('云同步')}>
      <div className="section-heading">
        <h2>
          <Icon name="shield" size={20} />
          {onboarding ? t('已有云端账本？') : t('云同步')}
        </h2>
        <span className="subtle">{t('可选 · 加密上传')}</span>
      </div>
      <p role="status">{messageText(status.message)}</p>
      {isNative && (
        <p className="subtle">
          {t('与网页版共用账号和账本：')}
          {new URL(NATIVE_SYNC_ORIGIN).hostname}
        </p>
      )}
      {onboarding && <p>{t('换手机或在另一台设备使用，请先连接已有空间。无需先创建空账本。')}</p>}
      {localPreview && (
        <p className="sync-notice">
          {t('本地测试环境：这里的同步不会上传到正式网站。多设备使用请打开同一个正式网址。')}
        </p>
      )}
      {status.accountId && (
        <p className="subtle">
          {t('同步空间 ')}
          {status.accountId.slice(0, 12)}
          {status.syncedAt > 0 &&
            t(' · 最近同步 {0}', [new Date(status.syncedAt).toLocaleString(getLocale())])}
        </p>
      )}
      {status.summary && (
        <p className="sync-summary">
          {t('最近成功同步：')}
          {status.summary.books}
          {t(' 个账本 · ')}
          {status.summary.entries} {t('笔记录（不含回收站）')}
        </p>
      )}
      {status.connected && active && active.count === 0 && othersWithRecords.length > 0 && (
        <p className="sync-notice">
          {t('当前“')}
          {active.book.name}
          {t('”没有记录，另外 ')}
          {othersWithRecords.length}{' '}
          {t('个账本有记录。请查看全部账本并切换；同名账本也会分别保留。')}
        </p>
      )}
      <p className="subtle">
        {t(
          '开启后同步所有账本、记录、分类、支付方式、预算和模板。草稿和文件备份记录仅保留在本机。断网可继续记账。',
        )}
      </p>
      <div className="sync-actions">
        <AccountAccess
          connected={status.connected}
          disabled={status.busy}
          canRegister={!status.accountId}
        />
        {onOpenBooks && status.accountId && (
          <button className="secondary" onClick={onOpenBooks}>
            {t('查看全部账本')}
          </button>
        )}
        {status.connected ? (
          <>
            <button
              className="primary"
              disabled={status.busy}
              onClick={() => void syncClient.sync()}
            >
              {t('立即同步')}
            </button>
            <button
              className="secondary"
              disabled={status.busy}
              onClick={async () => {
                try {
                  setKey(await syncClient.savedKey());
                  setMode('key');
                } catch {
                  notify(t('同步配置暂时无法读取，请重试'));
                }
              }}
            >
              {t('查看同步密钥')}
            </button>
            <button
              className="secondary"
              disabled={status.busy}
              onClick={async () => {
                if (
                  await confirm(
                    t('断开这台设备？'),
                    t(
                      '本机和云端数据都保留。重新连接时可使用已绑定的账号密码或原同步密钥。请先保存恢复密钥；未同步修改会留在本机。',
                    ),
                    false,
                    t('断开同步'),
                  )
                ) {
                  try {
                    await syncClient.disconnect();
                  } catch {
                    notify(t('断开失败，请重试'));
                  }
                }
              }}
            >
              {t('断开同步')}
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
                {t('创建同步空间')}
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
              {t('使用已有密钥连接')}
            </button>
          </>
        )}
      </div>
      <details className="sync-help">
        <summary>{t('如何在另一台设备继续记账？')}</summary>
        <p>
          {t(
            '两台设备打开同一个网站。已绑定账号时选择“账号登录”；老用户也可使用已有密钥连接。核对两端同步空间编号相同，再查看全部账本。',
          )}
        </p>
        <p>
          {t(
            '首次使用先创建同步空间，再到“账号与密码”绑定账号。创建码只用于新建空间，不是登录密码。原同步密钥也是恢复密钥，用于解密和重置密码，请保存在密码管理器，不要发给他人。',
          )}
        </p>
      </details>
      {status.conflicts.length > 0 && (
        <div className="sync-conflicts">
          <h3>
            {t('有 ')}
            {status.conflicts.length}
            {t(' 项修改需要确认')}
          </h3>
          <p>
            {t(
              '两端原始数据暂时保留。选择每项要保留的版本后再同步；关联数据冲突会按整个账本选择。同步前会自动保存本机保护副本。',
            )}
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
                      {t('保留')}
                      {side === 'local' ? t('本机') : t('云端')}
                      {t('版本')}
                    </label>
                    <details>
                      <summary>{t('查看内容')}</summary>
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
            {t('确认选择并同步')}
          </button>
        </div>
      )}
      {mode && (
        <Dialog
          title={
            mode === 'create'
              ? t('创建同步空间')
              : mode === 'join'
                ? t('连接同步空间')
                : t('同步密钥')
          }
          onClose={close}
          compact
          autoFocus={false}
        >
          <form
            className="sync-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setError('');
              try {
                await syncClient.connect(key, mode === 'create' ? setup : undefined);
                close();
              } catch (e) {
                setError(e instanceof Error ? e.message : t('连接失败，请重试'));
              }
            }}
          >
            <p className="dialog-copy">
              {t(
                '同步密钥就是登录凭证，也用于解密账目。请保存到密码管理器，不要发给别人。密钥遗失且所有设备都已退出后，无法找回云端账目。',
              )}
            </p>
            <Label title={t('同步密钥')}>
              <textarea
                className="sync-key"
                aria-label={t('同步密钥')}
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
                    notify(t('密钥已复制，请保存到安全位置'));
                  } catch {
                    setError(t('无法自动复制，请手动选择并复制密钥'));
                  }
                }}
              >
                {t('复制同步密钥')}
              </button>
            )}
            {mode === 'create' && (
              <>
                <Label title={t('管理员提供的创建码')}>
                  <input
                    aria-label={t('创建码')}
                    type="password"
                    autoComplete="off"
                    value={setup}
                    onChange={(e) => setSetup(e.target.value)}
                    maxLength={200}
                    required
                  />
                </Label>
                <p className="subtle">
                  {t('创建码由网站管理员配置，只在创建时使用。连接已有空间不需要创建码。')}
                </p>
                <label className="sync-check">
                  <input
                    type="checkbox"
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                  />
                  {t('我已安全保存同步密钥')}
                </label>
              </>
            )}
            {mode !== 'key' && (
              <p className="dialog-copy">
                {t(
                  '连接后，会将本机所有账本与此空间合并并开启自动同步。已有记录不会整库覆盖；冲突会提示你处理。',
                )}
              </p>
            )}
            {error && <p role="alert">{messageText(error)}</p>}
            {mode !== 'key' && (
              <button
                className="primary wide"
                disabled={status.busy || (mode === 'create' && !saved)}
              >
                {status.busy ? t('连接中…') : t('连接并开启同步')}
              </button>
            )}
          </form>
        </Dialog>
      )}
    </section>
  );
}

export function SyncStatusButton({ onOpen }: { onOpen: () => void }) {
  useLocale();
  const status = useSyncExternalStore(syncClient.subscribe, syncClient.snapshot);
  if (!syncSupported || !status.accountId) return null;
  return (
    <button className="sync-status-button" onClick={onOpen} aria-label={t('查看云同步状态')}>
      <Icon name={status.conflicts.length ? 'info' : 'shield'} size={14} />
      {status.connected ? messageText(status.message) : t('云同步已断开')}
    </button>
  );
}
