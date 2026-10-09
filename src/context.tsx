import { ProtectionPanel } from './ProtectionPanel';
import { PwaPanel } from './PwaPanel';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyState, type State, localTime } from './model';
import { repository } from './storage';
import { inheritBudgets } from './domain';
import { Dialog, Icon } from './ui';
type Confirm = {
  title: string;
  body: string;
  destructive?: boolean;
  action?: string;
  resolve: (answer: boolean) => void;
};
interface AppContextValue {
  state: State;
  run: (fn: (s: State) => void, message?: string) => Promise<boolean>;
  notify: (text: string) => void;
  confirm: (
    title: string,
    body: string,
    destructive?: boolean,
    action?: string,
  ) => Promise<boolean>;
  clear: () => Promise<void>;
}
const Context = createContext<AppContextValue | null>(null);
export function LedgerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(emptyState),
    [ready, setReady] = useState(false),
    [fatal, setFatal] = useState('');
  const [toast, setToast] = useState(''),
    [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = (text: string) => {
    clearTimeout(timer.current);
    setToast(text);
    timer.current = setTimeout(() => setToast(''), 5000);
  };
  useEffect(() => {
    repository
      .transaction((s) => {
        for (const b of s.books) inheritBudgets(s, b.id, localTime(b.timezone).slice(0, 7));
      })
      .then((s) => {
        setState(s);
        setReady(true);
      })
      .catch(() => setFatal('本地数据无法读取。请保留现有数据，重启后重试；不要清除应用数据。'));
    const reload = () => {
      repository
        .load()
        .then(setState)
        .catch(() => notify('读取失败，请重试'));
    };
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('focus', reload);
      clearTimeout(timer.current);
    };
  }, []);
  const run = async (fn: (s: State) => void, message?: string) => {
    try {
      setState(await repository.transaction(fn));
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(
        error instanceof Error
          ? error.name === 'ZodError'
            ? '数据校验失败，请检查输入或备份内容'
            : error.message
          : '保存失败，请重试',
      );
      return false;
    }
  };
  const confirm = (title: string, body: string, destructive = false, action = '确认') =>
    new Promise<boolean>((resolve) =>
      setConfirmation({ title, body, destructive, action, resolve }),
    );
  const answer = (value: boolean) => {
    confirmation?.resolve(value);
    setConfirmation(null);
  };
  if (fatal)
    return (
      <div className="boot">
        <Icon name="shield" size={40} />
        <h1>暂时无法打开账本</h1>
        <p>{fatal}</p>
        <ProtectionPanel recovery />
        <PwaPanel />
        <button className="primary" onClick={() => location.reload()}>
          重新打开
        </button>
      </div>
    );
  if (!ready)
    return (
      <div className="boot">
        <div className="brand-mark">
          <Icon name="wallet" size={32} />
        </div>
        <h2>打开你的账本</h2>
        <p>正在读取本机数据…</p>
      </div>
    );
  return (
    <Context.Provider
      value={{ state, run, notify, confirm, clear: async () => setState(await repository.clear()) }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          <Icon name="info" size={18} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      {confirmation && (
        <Dialog title={confirmation.title} onClose={() => answer(false)} compact>
          <p className="dialog-copy">{confirmation.body}</p>
          <div className="actions">
            <button className="secondary" onClick={() => answer(false)}>
              取消
            </button>
            <button
              className={confirmation.destructive ? 'danger' : 'primary'}
              onClick={() => answer(true)}
            >
              {confirmation.action}
            </button>
          </div>
        </Dialog>
      )}
    </Context.Provider>
  );
}
export function useLedger() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing provider');
  return value;
}
