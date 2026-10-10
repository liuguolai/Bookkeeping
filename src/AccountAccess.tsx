import { t, useLocale } from './i18n';
import { messageText } from './i18n';
import { useRef, useState } from 'react';
import { Dialog, Label } from './ui';
import { useLedger } from './context';
import {
  accountClient,
  type AccountInfo,
  normalizeUsername,
  validatePassword,
} from './sync/account';
import { credentials, newSyncKey } from './sync/crypto';
import { syncClient } from './sync/client';

export function AccountAccess({
  connected,
  disabled,
  canRegister = false,
}: {
  connected: boolean;
  disabled: boolean;
  canRegister?: boolean;
}) {
  useLocale();
  const { notify } = useLedger();
  const [mode, setMode] = useState<'login' | 'register' | 'manage' | 'recover' | null>(null);
  const [setup, setSetup] = useState('');
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState(''),
    [recovery, setRecovery] = useState('');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const clearFields = () => {
    setPassword('');
    setRepeat('');
    setRecovery('');
    setSetup('');
    setSaved(false);
    setError('');
  };
  const close = () => {
    if (!lock.current) {
      setMode(null);
      clearFields();
      setUsername('');
      setAccount(null);
    }
  };
  const open = async (next: 'login' | 'register' | 'manage' | 'recover') => {
    if (lock.current) return;
    clearFields();
    setUsername('');
    setAccount(null);
    setLoaded(false);
    setMode(next);
    if (next === 'register') setRecovery(newSyncKey());
    if (next !== 'manage') return;
    lock.current = true;
    setBusy(true);
    try {
      const info = await accountClient.current(await syncClient.savedKey());
      setAccount(info);
      setUsername(info?.username ?? '');
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('账号读取失败，请重试'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const checkSpace = async (secret: string) => {
    const identity = await credentials(secret);
    const owner = syncClient.snapshot().accountId;
    if (owner && owner !== identity.accountId)
      throw new Error(t('本机已关联其他同步空间。请先备份并整理本机数据，不会自动切换或混合账号'));
  };
  return (
    <>
      {canRegister && (
        <button
          className="primary"
          disabled={disabled || busy}
          onClick={() => void open('register')}
        >
          {t('注册账号')}
        </button>
      )}
      <button
        className={connected ? 'secondary' : 'primary'}
        disabled={disabled || busy}
        onClick={() => void open(connected ? 'manage' : 'login')}
      >
        {connected ? t('账号与密码') : t('账号登录')}
      </button>
      {mode && (
        <Dialog
          title={
            mode === 'login'
              ? t('账号登录')
              : mode === 'register'
                ? t('注册账号')
                : mode === 'recover'
                  ? t('恢复账号密码')
                  : t('账号与密码')
          }
          onClose={close}
          compact
        >
          <form
            className="account-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (lock.current) return;
              if (mode !== 'login' && !saved) return;
              lock.current = true;
              setBusy(true);
              setError('');
              let complete = false;
              try {
                validatePassword(password);
                if (mode !== 'login' && password !== repeat)
                  throw new Error(t('两次输入的密码不一致'));
                if (mode === 'register') {
                  normalizeUsername(username);
                  await checkSpace(recovery);
                  // Reuse this key on retries, including a lost creation/binding response.
                  if (!syncClient.snapshot().connected) await syncClient.connect(recovery, setup);
                  const existing = await accountClient.current(recovery);
                  if (!existing) await accountClient.bind(recovery, username, password);
                  notify(
                    t('账号 {0} 已注册，可在其他设备登录。请保存恢复密钥', [
                      existing?.username ?? normalizeUsername(username),
                    ]),
                  );
                } else if (mode === 'login') {
                  const secret = await accountClient.login(username, password);
                  await checkSpace(secret);
                  await syncClient.connect(secret);
                  notify(t('账号已连接，请查看云同步状态和全部账本'));
                } else if (mode === 'recover') {
                  await checkSpace(recovery);
                  const name = await accountClient.recover(recovery, password);
                  // Resetting a password and downloading records are separate outcomes.
                  try {
                    await syncClient.connect(recovery);
                  } catch {
                    notify(t('账号 {0} 的密码已更新。连接未完成，可用新密码重新登录', [name]));
                    complete = true;
                    return;
                  }
                  notify(t('账号 {0} 的密码已更新，请保存新密码', [name]));
                } else {
                  const secret = await syncClient.savedKey();
                  await accountClient.bind(secret, username, password, account?.revision ?? 0);
                  notify(
                    account
                      ? t('密码已更新，原有账目和同步空间保留')
                      : t('账号已绑定，其他设备可使用账号密码登录'),
                  );
                }
                complete = true;
              } catch (e) {
                setError(e instanceof Error ? e.message : t('操作失败，请重试'));
              } finally {
                lock.current = false;
                setBusy(false);
                if (complete) close();
              }
            }}
          >
            {mode === 'register' && (
              <>
                <p className="dialog-copy">
                  {t(
                    '注册后开启加密云同步，可用账号密码在其他设备继续记账。本机已有账本也会同步。',
                  )}
                </p>
                {connected ? (
                  <p className="sync-notice">
                    {t(
                      '同步空间已创建。若注册未完成，请继续提交，或稍后在“账号与密码”中完成绑定。',
                    )}
                  </p>
                ) : (
                  <Label title={t('管理员提供的创建码')}>
                    <input
                      aria-label={t('创建码')}
                      type="password"
                      autoComplete="off"
                      value={setup}
                      onChange={(e) => setSetup(e.target.value)}
                      maxLength={200}
                      required
                      disabled={busy}
                    />
                    <small>
                      {t('创建码由网站管理员配置，只在创建时使用。连接已有空间不需要创建码。')}
                    </small>
                  </Label>
                )}
                <Label title={t('恢复密钥')}>
                  <textarea
                    aria-label={t('恢复密钥')}
                    className="sync-key"
                    value={recovery}
                    readOnly
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Label>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(recovery);
                      notify(t('密钥已复制，请保存到安全位置'));
                    } catch {
                      setError(t('无法自动复制，请手动选择并复制密钥'));
                    }
                  }}
                >
                  {t('复制恢复密钥')}
                </button>
              </>
            )}
            {mode === 'login' && (
              <p className="dialog-copy">
                {t(
                  '登录后将恢复云端账本，并合并本机已有账本，冲突会提示处理。老用户仍可使用同步密钥连接，再设置账号密码。',
                )}
              </p>
            )}
            {mode === 'manage' && (
              <p className="dialog-copy">
                {account
                  ? t('已绑定账号：{0}。此处设置新密码，账号名称保持不变。', [account.username])
                  : t('为当前同步空间设置账号密码。原账目和同步密钥保留，不会新建重复空间。')}
              </p>
            )}
            {mode === 'recover' && (
              <>
                <p className="dialog-copy">
                  {t(
                    '使用恢复密钥（原来以 pl1_ 开头的同步密钥）设置新密码，无需记住账号名。没有恢复密钥时，可在仍连接的设备中查看；两者都没有则无法恢复。',
                  )}
                </p>
                <Label title={t('恢复密钥')}>
                  <textarea
                    aria-label={t('恢复密钥')}
                    className="sync-key"
                    value={recovery}
                    onChange={(e) => setRecovery(e.target.value)}
                    maxLength={100}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    disabled={busy}
                  />
                </Label>
              </>
            )}
            {mode !== 'recover' && (
              <Label title={t('账号名')}>
                <input
                  aria-label={t('账号名')}
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={32}
                  required
                  readOnly={!!account}
                  disabled={busy}
                />
                <small>
                  {t('3–32 位英文字母、数字、下划线或短横线，不区分大小写；不是邮箱。')}
                </small>
              </Label>
            )}
            <Label title={mode === 'login' ? t('密码') : t('新密码')}>
              <input
                aria-label={mode === 'login' ? t('密码') : t('新密码')}
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                maxLength={128}
                required
                disabled={busy}
              />
              <small>{t('至少 8 个字符，可用密码管理器生成。')}</small>
            </Label>
            {mode !== 'login' && (
              <>
                <Label title={t('确认新密码')}>
                  <input
                    aria-label={t('确认新密码')}
                    name="password-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    minLength={8}
                    maxLength={128}
                    required
                    disabled={busy}
                  />
                </Label>
                <p className="dialog-copy">
                  {t(
                    '恢复密钥仍可连接和重置密码，请保存在密码管理器。修改密码不会让已连接设备退出；设备遗失时不能仅靠改密码撤销其访问。',
                  )}
                </p>
                <label className="sync-check">
                  <input
                    type="checkbox"
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                    disabled={busy}
                  />
                  {t('我已保存恢复密钥并了解上述说明')}
                </label>
                {mode === 'manage' && !account && (
                  <p className="subtle">
                    {t('可先关闭此窗口，在“查看同步密钥”中复制并保存恢复密钥。')}
                  </p>
                )}
              </>
            )}
            {error && <p role="alert">{messageText(error)}</p>}
            <button
              className="primary wide"
              disabled={busy || (mode === 'manage' && !loaded) || (mode !== 'login' && !saved)}
            >
              {busy
                ? t('正在处理…')
                : mode === 'login'
                  ? t('登录并同步')
                  : mode === 'register'
                    ? t('注册并开启同步')
                    : mode === 'recover'
                      ? t('重设密码并连接')
                      : account
                        ? t('更新密码')
                        : t('绑定账号')}
            </button>
            {mode === 'login' && (
              <>
                {canRegister && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void open('register')}
                  >
                    {t('没有账号？立即注册')}
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void open('recover')}
                >
                  {t('忘记账号或密码？用恢复密钥找回')}
                </button>
              </>
            )}
          </form>
        </Dialog>
      )}
    </>
  );
}
