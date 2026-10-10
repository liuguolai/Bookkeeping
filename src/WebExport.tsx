import { t, useLocale } from './i18n';
import { messageText } from './i18n';
import { useEffect, useMemo, useState } from 'react';

export type PreparedExport = { name: string; text: string; mime: string };
export function WebExport({ value }: { value: PreparedExport }) {
  useLocale();
  const file = useMemo(() => new File([value.text], value.name, { type: value.mime }), [value]);
  const [url, setUrl] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    setMessage('');
    return () => URL.revokeObjectURL(next);
  }, [file]);
  let shareable = false;
  try {
    shareable = !!navigator.canShare?.({ files: [file] });
  } catch {
    /* Download remains available. */
  }
  return (
    <aside className="web-export" aria-label={t('已生成的文件')}>
      <b>
        {t('文件已生成：')}
        {value.name}
      </b>
      <p>
        {t(
          '这是点击生成时的快照。请确认文件已保存，再关闭此窗口。iPhone 可在系统分享中选择“存储到文件”。',
        )}
      </p>
      <div className="pwa-actions">
        <a className="secondary" href={url || undefined} download={value.name}>
          {t('下载文件')}
        </a>
        {shareable && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                // Keep the share call directly in the click gesture, especially on iOS.
                await navigator.share({ files: [file], title: value.name });
                setMessage(t('已交给系统分享，请确认文件已保存。'));
              } catch (error) {
                setMessage(
                  error instanceof Error && error.name === 'AbortError'
                    ? t('已取消分享，可再次分享或下载文件。')
                    : t('系统分享未完成，请使用下载文件。'),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('分享或存储到文件')}
          </button>
        )}
      </div>
      {message && <p role="status">{messageText(message)}</p>}
    </aside>
  );
}
