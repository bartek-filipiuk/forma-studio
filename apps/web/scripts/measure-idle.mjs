import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.FORMA_CHROMIUM_PATH, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.drawCalls = 0;
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = prototype[name];
        if (!original || !Object.hasOwn(prototype, name)) continue;
        prototype[name] = function (...args) { window.drawCalls++; return original.apply(this, args); };
      }
    }
  });
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, username: 'fixture-owner', csrf_token: 'fixture-token' } }));
  await page.goto(new URL('/app', process.env.FORMA_TEST_URL ?? 'http://127.0.0.1:18181').href);
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(10000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  await page.evaluate(() => { window.drawCalls = 0; });
  await page.waitForTimeout(3000);
  const drawCalls = await page.evaluate(() => window.drawCalls);
  const after = await cdp.send('Performance.getMetrics');
  const metric = (result, name) => result.metrics.find(m => m.name === name).value;
  console.log(JSON.stringify({ viewport: '1440x900', renderer: 'Chromium software WebGL', requested_sample_ms: 3000, elapsed_ms: (metric(after, 'Timestamp') - metric(before, 'Timestamp')) * 1000, draw_calls: drawCalls, task_ms: (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000 }, null, 2));
} finally { await browser.close(); }
