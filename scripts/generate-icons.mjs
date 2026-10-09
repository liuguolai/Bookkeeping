import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const svg = await readFile('public/icon.svg', 'utf8');
const symbol = svg.slice(svg.indexOf('<path'), svg.lastIndexOf('</svg>'));
await mkdir('public/icons', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, maskable] of [
    ['icon-192', 192, false],
    ['icon-512', 512, false],
    ['apple-touch-icon', 180, false],
    ['maskable-512', 512, true],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    const drawing = maskable
      ? `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#dd663d"/><g transform="translate(11.2 11.2) scale(.65)">${symbol}</g></svg>`
      : svg;
    await page.setContent(
      `<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#dd663d}svg{width:100%;height:100%;display:block}</style>${drawing}`,
    );
    await page.screenshot({ path: `public/icons/${name}.png` });
  }
} finally {
  await browser.close();
}
