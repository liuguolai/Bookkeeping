import { t } from './i18n';
import { Capacitor } from '@capacitor/core';
export async function saveFile(
  name: string,
  text: string,
  mime = 'application/octet-stream',
): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const path = `exports/${Date.now()}-${name}`;
    const file = await Filesystem.writeFile({
      path,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    try {
      await Share.share({ title: name, url: file.uri, dialogTitle: t('保存或分享文件') });
    } catch {
      throw new Error(t('保存或分享未完成，请重试'));
    }
    return t('已交给系统保存或分享，请确认文件已保存');
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return t('已发起下载，请在下载目录确认文件');
}
export async function clearExportCache() {
  if (!Capacitor.isNativePlatform()) return;
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    await Filesystem.stat({ path: 'exports', directory: Directory.Cache });
  } catch {
    return;
  }
  await Filesystem.rmdir({ path: 'exports', directory: Directory.Cache, recursive: true });
}
