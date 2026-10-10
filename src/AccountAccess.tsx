import { useRef, useState } from 'react';
import { Dialog, Label } from './ui';
import { useLedger } from './context';
import { accountClient, type AccountInfo, validatePassword } from './sync/account';
import { credentials } from './sync/crypto';
import { syncClient } from './sync/client';

export function AccountAccess({ connected, disabled }: { connected: boolean; disabled: boolean }) {
  const { notify } = useLedger();
  const [mode, setMode] = useState<'login' | 'manage' | 'recover' | null>(null);
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
  const open = async (next: 'login' | 'manage' | 'recover') => {
    if (lock.current) return;
    clearFields();
    setUsername('');
    setAccount(null);
    setLoaded(false);
    setMode(next);
    if (next !== 'manage') return;
    lock.current = true;
    setBusy(true);
    try {
      const info = await accountClient.current(await syncClient.savedKey());
      setAccount(info);
      setUsername(info?.username ?? '');
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '账号读取失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const checkSpace = async (secret: string) => {
    const identity = await credentials(secret);
    const owner = syncClient.snapshot().accountId;
    if (owner && owner !== identity.accountId)
      throw new Error('本机已关联其他同步空间。请先备份并整理本机数据，不会自动切换或混合账号');
  };
  return (
    <>
      <button
        className={connected ? 'secondary' : 'primary'}
        disabled={disabled || busy}
        onClick={() => void open(connected ? 'manage' : 'login')}
      >
        {connected ? '账号与密码' : '账号登录'}
      </button>
      {mode && (
        <Dialog
          title={mode === 'login' ? '账号登录' : mode === 'recover' ? '恢复账号密码' : '账号与密码'}
          onClose={close}
          compact
        >
          <form
            className="account-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              setError('');
              let complete = false;
              try {
                validatePassword(password);
                if (mode !== 'login' && password !== repeat)
                  throw new Error('两次输入的密码不一致');
                if (mode === 'login') {
                  const secret = await accountClient.login(username, password);
                  await checkSpace(secret);
                  await syncClient.connect(secret);
                  notify('账号已连接，请查看云同步状态和全部账本');
                } else if (mode === 'recover') {
                  await checkSpace(recovery);
                  const name = await accountClient.recover(recovery, password);
                  // Resetting a password and downloading records are separate outcomes.
                  try {
                    await syncClient.connect(recovery);
                  } catch {
                    notify(`账号 ${name} 的密码已更新。连接未完成，可用新密码重新登录`);
                    complete = true;
                    return;
                  }
                  notify(`账号 ${name} 的密码已更新，请保存新密码`);
                } else {
                  const secret = await syncClient.savedKey();
                  await accountClient.bind(secret, username, password, account?.revision ?? 0);
                  notify(
                    account
                      ? '密码已更新，原有账目和同步空间保留'
                      : '账号已绑定，其他设备可使用账号密码登录',
                  );
                }
                complete = true;
              } catch (e) {
                setError(e instanceof Error ? e.message : '操作失败，请重试');
              } finally {
                lock.current = false;
                setBusy(false);
                if (complete) close();
              }
            }}
          >
            {mode === 'login' && (
              <p className="dialog-copy">
                登录后将恢复云端账本，并合并本机已有账本，冲突会提示处理。老用户仍可使用同步密钥连接，再设置账号密码。
              </p>
            )}
            {mode === 'manage' && (
              <p className="dialog-copy">
                {account
                  ? `已绑定账号：${account.username}。此处设置新密码，账号名称保持不变。`
                  : '为当前同步空间设置账号密码。原账目和同步密钥保留，不会新建重复空间。'}
              </p>
            )}
            {mode === 'recover' && (
              <>
                <p className="dialog-copy">
                  使用恢复密钥（原来以 pl1_
                  开头的同步密钥）设置新密码，无需记住账号名。没有恢复密钥时，可在仍连接的设备中查看；两者都没有则无法恢复。
                </p>
                <Label title="恢复密钥">
                  <textarea
                    aria-label="恢复密钥"
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
              <Label title="账号名">
                <input
                  aria-label="账号名"
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
                <small>3–32 位英文字母、数字、下划线或短横线，不区分大小写；不是邮箱。</small>
              </Label>
            )}
            <Label title={mode === 'login' ? '密码' : '新密码'}>
              <input
                aria-label={mode === 'login' ? '密码' : '新密码'}
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
              <small>至少 8 个字符，可用密码管理器生成。</small>
            </Label>
            {mode !== 'login' && (
              <>
                <Label title="确认新密码">
                  <input
                    aria-label="确认新密码"
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
                  恢复密钥仍可连接和重置密码，请保存在密码管理器。修改密码不会让已连接设备退出；设备遗失时不能仅靠改密码撤销其访问。
                </p>
                <label className="sync-check">
                  <input
                    type="checkbox"
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                    disabled={busy}
                  />
                  我已保存恢复密钥并了解上述说明
                </label>
                {mode === 'manage' && !account && (
                  <p className="subtle">可先关闭此窗口，在“查看同步密钥”中复制并保存恢复密钥。</p>
                )}
              </>
            )}
            {error && <p role="alert">{error}</p>}
            <button
              className="primary wide"
              disabled={busy || (mode === 'manage' && !loaded) || (mode !== 'login' && !saved)}
            >
              {busy
                ? '正在处理…'
                : mode === 'login'
                  ? '登录并同步'
                  : mode === 'recover'
                    ? '重设密码并连接'
                    : account
                      ? '更新密码'
                      : '绑定账号'}
            </button>
            {mode === 'login' && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void open('recover')}
              >
                忘记账号或密码？用恢复密钥找回
              </button>
            )}
          </form>
        </Dialog>
      )}
    </>
  );
}
