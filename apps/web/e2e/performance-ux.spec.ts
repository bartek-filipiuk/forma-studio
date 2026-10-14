import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Isolated browser tests: the real WebGL renderer and loaders run; HTTP boundaries
// are fixtures so the user's Compose workspace can remain stopped.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, username: 'fixture-owner', csrf_token: 'fixture-token' } }));
  await page.route('**/api/health', route => route.fulfill({ status: 503, json: { detail: 'Offline test' } }));
});

async function countDraws(page: Page) {
  await page.addInitScript(() => {
    const counter = window as typeof window & { drawCalls: number };
    counter.drawCalls = 0;
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const methods = prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
        const original = methods[name];
        if (!original || !Object.hasOwn(prototype, name)) continue;
        methods[name] = function (...args) { counter.drawCalls++; return original.apply(this, args); };
      }
    }
  });
}
async function draws(page: Page) {
  return page.evaluate(() => (window as typeof window & { drawCalls: number }).drawCalls);
}

test('scene rests when idle and redraws for editing, orbit, zoom and resize', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await countDraws(page);
  await page.goto('/app');
  await expect.poll(() => draws(page)).toBeGreaterThan(0);
  await page.waitForTimeout(5000);
  const idle = await draws(page);
  await page.waitForTimeout(1500);
  expect(await draws(page)).toBe(idle);
  const canvas = page.locator('canvas');
  const beforeEdit = await canvas.screenshot({ mask: [page.locator('.scene-toolbar')] });
  const width = page.getByRole('spinbutton', { name: 'Szerokość', exact: true });
  await width.fill('140');
  await width.press('Enter');
  await expect.poll(() => draws(page)).toBeGreaterThan(idle);
  await expect(page.locator('.dimension')).toHaveText('140.0 mm');
  expect((await canvas.screenshot({ mask: [page.locator('.scene-toolbar')] })).equals(beforeEdit)).toBe(false);
  await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
  await expect(page.locator('.dimension')).toHaveText('110.0 mm');
  const box = (await canvas.boundingBox())!;
  const beforeOrbit = await draws(page);
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => draws(page)).toBeGreaterThan(beforeOrbit);
  const beforeZoom = await draws(page);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => draws(page)).toBeGreaterThan(beforeZoom);
  await page.getByRole('button', { name: 'Dopasuj widok', exact: true }).click();
  await page.getByRole('button', { name: 'Prześwietlenie obudów', exact: true }).click();
  await page.getByRole('button', { name: 'Przesuń', exact: true }).click();
  await page.getByRole('button', { name: 'Obróć', exact: true }).click();
  await page.getByRole('button', { name: 'Zaznacz', exact: true }).click();
  await page.screenshot({ path: info.outputPath('desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(391);
  await page.getByRole('button', { name: 'Pokaż właściwości' }).click();
  await page.getByText('Skróty klawiaturowe', { exact: true }).click();
  await expect(page.getByText('Zapisz projekt', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('mobile.png') });
  expect(errors).toEqual([]);
});

test('library explains no results and clears all filters', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Biblioteka', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Znajdź element' });
  await page.getByRole('button', { name: 'Elektronika', exact: true }).click();
  await search.fill('nonexistent');
  await expect(page.getByRole('status')).toHaveText('Brak pasujących elementów.Wyczyść filtry');
  await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.catalog-card')).toHaveCount(8);
});

test('failed chat restores the command without overwriting a newer draft', async ({ page }) => {
  let release!: () => void;
  let gate = Promise.resolve();
  let received = 0;
  await page.route('**/api/chat', async route => {
    received++;
    await gate;
    await route.fulfill({ status: 503, json: { detail: 'Test unavailable' } });
  });
  await page.goto('/app');
  const input = page.getByRole('textbox', { name: 'Polecenie projektowania' });
  const send = page.getByRole('button', { name: 'Wyślij polecenie' });
  await input.fill('ścianka 3 mm');
  await send.click();
  await expect(input).toHaveValue('ścianka 3 mm');
  gate = new Promise<void>(resolve => { release = resolve; });
  await send.click();
  await expect.poll(() => received).toBe(2);
  await input.fill('nowe polecenie');
  release();
  await expect(send).toBeEnabled();
  await expect(input).toHaveValue('nowe polecenie');
});

test('STL color changes reuse the loaded mesh and deletion cleans up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = JSON.parse(await readFile(resolve('../../samples/pico.forma.json'), 'utf8'));
  project.parts = [{ id: 'test-mesh', name: 'Test STL', template: 'mesh', role: 'print', color: '#dddcd4', visible: true, params: {}, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, asset_id: 'test-asset', fit_to: null, clearance: .4, group: 'free' }];
  await page.addInitScript(project => localStorage.setItem('forma.studio.v1', JSON.stringify({ project, serverVersion: null, savedRevision: -1 })), project);
  let loads = 0;
  await page.route('**/api/assets/test-asset', route => route.fulfill({ json: { mime: 'model/stl', url: '/api/assets/test-asset/content' } }));
  await page.route('**/api/assets/test-asset/content', async route => {
    loads++;
    await route.fulfill({ contentType: 'model/stl', body: await readFile(resolve('../../samples/exports/pico-base.stl')) });
  });
  await page.goto('/app');
  await expect.poll(() => loads).toBe(1);
  await expect(page.locator('.mesh-loading')).toHaveCount(0);
  const canvas = page.locator('canvas');
  const beforeColor = await canvas.screenshot({ mask: [page.locator('.scene-toolbar')] });
  await page.getByRole('button', { name: /^Kolor / }).nth(2).click();
  expect((await canvas.screenshot({ mask: [page.locator('.scene-toolbar')] })).equals(beforeColor)).toBe(false);
  expect(loads).toBe(1);
  await page.getByRole('button', { name: 'Usuń część' }).click();
  await expect(page.getByText('Co dziś zbudujesz?')).toBeVisible();
  await page.getByRole('button', { name: 'Cofnij', exact: true }).click();
  await expect.poll(() => loads).toBe(2);
  await expect(page.locator('.mesh-loading')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('embedded GLB loads on demand and keeps its source material when recolored', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Small embedded triangle in meters, rendered by the real GLTFLoader.
  const vertices = new Float32Array([-.02, 0, 0, .02, 0, 0, 0, 0, .04]);
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.9, .1, .1, 1], metallicFactor: 0 } }],
    buffers: [{ byteLength: vertices.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-.02, 0, 0], max: [.02, 0, .04] }],
  });
  const padded = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + vertices.byteLength);
  glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
  glb.writeUInt32LE(vertices.byteLength, 20 + padded.length); glb.writeUInt32LE(0x004e4942, 24 + padded.length);
  Buffer.from(vertices.buffer).copy(glb, 28 + padded.length);
  const project = JSON.parse(await readFile(resolve('../../samples/pico.forma.json'), 'utf8'));
  project.parts = [{ ...project.parts[0], id: 'glb-part', template: 'mesh', params: {}, asset_id: 'glb-asset' }];
  await page.addInitScript(project => localStorage.setItem('forma.studio.v1', JSON.stringify({ project, serverVersion: null, savedRevision: -1 })), project);
  let loads = 0;
  await page.route('**/api/assets/glb-asset', route => route.fulfill({ json: { mime: 'model/gltf-binary', metadata: { units: 'meters' }, url: '/api/assets/glb-asset/content' } }));
  await page.route('**/api/assets/glb-asset/content', route => {
    loads++;
    return route.fulfill({ contentType: 'model/gltf-binary', body: glb });
  });
  await page.goto('/app');
  await expect.poll(() => loads).toBe(1);
  await expect(page.locator('.mesh-loading')).toHaveCount(0);
  await page.waitForTimeout(5000);
  const canvas = page.locator('canvas');
  const original = await canvas.screenshot({ mask: [page.locator('.scene-toolbar')] });
  await page.getByRole('button', { name: /^Kolor / }).nth(2).click();
  expect((await canvas.screenshot({ mask: [page.locator('.scene-toolbar')] })).equals(original)).toBe(true);
  expect(loads).toBe(1);
  await page.getByRole('button', { name: 'Usuń część' }).click();
  await expect(page.getByText('Co dziś zbudujesz?')).toBeVisible();
  expect(errors).toEqual([]);
});
