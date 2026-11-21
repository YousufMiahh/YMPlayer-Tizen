// Records the launch intro to a video (preview of the animation): node tools/shots/record-intro.mjs <outdir>
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';
const out = process.argv[2] || '.';
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto(`${server.url}/index.html`);
await page.waitForTimeout(4200);
await ctx.close();
await browser.close();
await server.close?.();
console.log('done');
