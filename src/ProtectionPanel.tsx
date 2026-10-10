import { useEffect, useRef, useState } from 'react';
import { repository } from './storage';
import { type ProtectionSnapshot } from './protection';
import { validateState } from './model';

export function ProtectionPanel({ recovery = false }: { recovery?: boolean }) {
  const [snapshots, setSnapshots] = useState<ProtectionSnapshot[]>([]);
  const [selected, setSelected] = useState<ProtectionSnapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const lock = useRef(false);
  const refresh = async () => setSnapshots(await repository.snapshots());
  useEffect(() => {
    void refresh().catch(() => setMessage('保护副本无法读取，请保留现有应用数据。'));
  }, []);
  const task = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(
        e instanceof Error && e.name !== 'ZodError' ? e.message : '副本校验失败，当前数据未被替换',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="protection-panel" aria-label="本机保护副本">
      <h3>本机保护副本</h3>
      <p className="dialog-copy">
        升级及云同步合并前自动留存，最多保留最近 3
        份，包含所有账本、草稿和回收站。卸载应用或丢失手机后无法使用，请另存加密备份到手机外。
      </p>
      {!recovery && (
        <button
          className="secondary wide"
          disabled={busy}
          onClick={() =>
            task(async () => {
              await repository.protect('manual');
              await refresh();
              setMessage('本机保护副本已创建');
            })
          }
        >
          创建本机保护副本
        </button>
      )}
      {message && (
        <p role="status" className="inline-note">
          {message}
        </p>
      )}
      {!snapshots.length && <p className="dialog-copy">暂无本机保护副本。</p>}
      {snapshots.map((s) => {
        let summary = '',
          valid = true;
        try {
          const state = validateState(JSON.parse(s.data));
          summary = `${state.books.length} 个账本 · ${state.entries.length} 笔记录 · ${state.templates.length} 个模板`;
        } catch {
          valid = false;
          summary = '副本内容无法校验，暂不可恢复';
        }
        return (
          <article className="template-card" key={s.id}>
            <h4>
              {s.reason === 'upgrade'
                ? '升级前'
                : s.reason === 'manual'
                  ? '手动创建'
                  : '恢复前自动留存'}
            </h4>
            <p>{new Date(s.createdAt).toLocaleString('zh-CN')}</p>
            <p>{summary}</p>
            {s.reason === 'upgrade' && (
              <p>
                版本 {s.fromVersion} → {s.toVersion}
              </p>
            )}
            <button className="secondary" disabled={busy || !valid} onClick={() => setSelected(s)}>
              查看恢复选项
            </button>
            {selected?.id === s.id && (
              <div className="restore-confirm">
                <p>
                  恢复将把全部本地账本还原到此时，包括草稿、回收站和模板。当前状态会先自动留存一份，恢复后可再次选择它撤回。
                  恢复后会断开本机云同步，避免自动覆盖云端；使用原同步密钥重新连接时再确认合并。
                </p>
                <div className="actions">
                  <button className="secondary" disabled={busy} onClick={() => setSelected(null)}>
                    取消恢复
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      task(async () => {
                        await repository.protect('restore', s.id);
                        location.reload();
                      })
                    }
                  >
                    确认还原全部账本
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
