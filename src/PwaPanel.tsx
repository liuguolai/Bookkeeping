import { useEffect, useRef, useState } from 'react';
import { activatePwaUpdate, checkPwaUpdate, installPwa, usePwa } from './pwa';
import { isNative, repository } from './storage';
import { Dialog } from './ui';
import { APP_VERSION } from './protection';

export function PwaPanel({ compact = false }: { compact?: boolean }) {
  const pwa = usePwa();
  const [help, setHelp] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [storage, setStorage] = useState('尚未检查');
  const lock = useRef(false);
  useEffect(() => {
    if (isNative || compact) return;
    let mounted = true;
    void navigator.storage
      ?.persisted?.()
      .then((granted) => {
        if (mounted)
          setStorage(
            granted ? '已获准持久存储；仍需定期导出备份。' : '尚未获准持久存储，可点击申请。',
          );
      })
      .catch(() => {
        if (mounted) setStorage('无法读取存储状态，请定期备份。');
      });
    return () => {
      mounted = false;
    };
  }, [compact]);
  if (isNative) return null;
  const task = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const update = () =>
    task(async () => {
      if (document.querySelector('[role="dialog"]'))
        throw new Error('请先保存并关闭正在编辑的窗口，再更新。');
      await repository.idle();
      await activatePwaUpdate();
    });
  const details = (
    <>
      <h3>添加到手机主屏幕</h3>
      <ol>
        <li>iPhone / iPad：用 Safari 打开固定的 HTTPS 网址。</li>
        <li>点击分享，选择“添加到主屏幕”；如果显示“作为网页 App 打开”，请开启。</li>
        <li>从桌面图标打开，联网等到“离线已就绪”，再断网使用。</li>
      </ol>
      <p>
        安卓和电脑可使用浏览器的“安装应用”或“添加到主屏幕”。未出现安装按钮时，可按浏览器菜单操作。
      </p>
      <h3>账目保存在这里</h3>
      <p>
        账目只存在当前网址、当前浏览器或桌面应用的本地存储中，不上传账目、不做云同步。网页版未启用原生数据库加密，加密导出的备份文件有密码保护。
      </p>
      <p>
        清除网站数据、卸载、存储空间不足或换设备都可能导致数据丢失。请在设置中定期导出加密备份，另存手机外，并确认文件可恢复。
      </p>
      <p>
        请固定使用同一个网址。换域名、浏览器或改从桌面图标打开时，不要假设数据自动共享；先备份，确认账目齐全后再继续记账。
      </p>
      <h3>离线与更新</h3>
      <p>
        首次下载和获取新版需要联网；离线就绪后可离线记账、统计、导出和恢复本地文件。托管平台只提供程序文件，可能记录访问
        IP 和浏览器等普通访问日志，应用没有广告或分析脚本。
      </p>
      <p>有新版时主动确认更新。请先保存编辑并关闭其他记账页面。更新只更换程序缓存，不清除账目。</p>
    </>
  );
  return (
    <section className={compact ? 'pwa-strip' : 'card pwa-panel'} aria-label="安装与离线使用">
      <div className="pwa-heading">
        <b>{compact ? '网页应用' : `安装与离线使用 · ${APP_VERSION}`}</b>
        <span role="status">
          {pwa.offline ? '当前离线 · ' : ''}
          {pwa.ready ? '离线已就绪' : '离线尚未就绪'}
          {pwa.installed ? ' · 主屏幕运行' : ''}
        </span>
      </div>
      {!compact && (
        <p>
          {pwa.error ||
            (pwa.ready
              ? '程序已缓存在本机，可断网使用。账目请另存加密备份。'
              : '首次使用请保持联网，等待离线文件准备完成。')}
        </p>
      )}
      <div className="pwa-actions">
        <button className="secondary" onClick={() => setHelp(true)}>
          安装与使用说明
        </button>
        {pwa.installable && (
          <button className="primary" onClick={() => task(installPwa)}>
            安装到桌面
          </button>
        )}
        {pwa.update && (
          <button className="primary" disabled={busy} onClick={update}>
            更新并重新打开
          </button>
        )}
        {!compact && (
          <button
            className="secondary"
            disabled={busy || !pwa.supported}
            onClick={() =>
              task(async () => {
                await checkPwaUpdate();
                setMessage('检查完成；如有新版，下载完成后会显示更新按钮。');
              })
            }
          >
            检查更新
          </button>
        )}
        {!compact && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              task(async () => {
                if (!navigator.storage?.persist) {
                  setStorage('当前浏览器不支持申请持久存储，请定期导出备份。');
                  return;
                }
                const granted = await navigator.storage.persist();
                setStorage(
                  granted
                    ? '已获准持久存储；主动清除、卸载或设备损坏仍会丢失数据。'
                    : '浏览器暂未授予持久存储，可从主屏幕打开后再试；请定期备份。',
                );
              })
            }
          >
            申请持久存储
          </button>
        )}
      </div>
      {pwa.update && (
        <p>新版已下载。先保存编辑并关闭其他记账窗口，再更新；也可稍后关闭所有窗口后重新打开。</p>
      )}
      {!compact && (
        <>
          <p className="inline-note">存储保护：{storage}</p>
          <p className="inline-note">
            网页版使用本地浏览器存储，清除网站数据会清除账目。更换网址前请先导出备份。
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {help && (
        <Dialog title="安装与离线使用" onClose={() => setHelp(false)}>
          <div className="pwa-help">{details}</div>
        </Dialog>
      )}
      {busy && (
        <div className="pwa-busy" role="status">
          正在处理，请稍候…
        </div>
      )}
    </section>
  );
}
