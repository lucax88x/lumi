import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const svg = await readFile('public/lumi.svg', 'utf8');
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable.png', 512]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:#f4edf9}svg{width:100%;height:100%;display:block}</style>${svg}`);
  await page.screenshot({ path: `public/${file}` }); await page.close();
}
await browser.close();
