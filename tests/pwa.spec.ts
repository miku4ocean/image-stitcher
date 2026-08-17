import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { makeSolidPng } from './fixtures/pngHelper';

// PWA（階段 3）相關驗證。這組測試走 http://localhost（playwright.config.ts 的 webServer），
// 因為 service worker 需要 http(s) 環境才能註冊，file:// 協定不支援；
// 既有 tests/stitch.spec.ts 走 file://，兩者互不影響。
test.describe('PWA', () => {
  test('manifest.json 可被 fetch 且必要欄位存在', async ({ page, request }) => {
    await page.goto('/index.html');
    // 注意：不能用 page.evaluate 內的 fetch()——index.html 的 CSP 刻意設
    // connect-src 'none'（本工具本來就不需要任何 fetch/XHR），page 內的 fetch 會被擋下，
    // 這是預期且不可弱化的安全行為。改用 Playwright 的 request context（不受頁面 CSP 限制）
    // 直接驗證 manifest.json 本身是有效、可被瀏覽器（透過 <link rel="manifest">）讀取的資源。
    const res = await request.get('/manifest.json');
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toBe('圖片拼接工具');
    expect(manifest.short_name).toBe('圖片拼接工具');
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('index.html 有正確引用 manifest／theme-color／apple-touch-icon', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.json');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#00CED1');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      'icons/apple-touch-icon.png'
    );
  });

  test('service worker 成功註冊', async ({ page }) => {
    await page.goto('/index.html');
    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { active: !!reg.active, scope: reg.scope };
    });
    expect(registered.active).toBe(true);
    expect(registered.scope).toContain('localhost');
  });

  test('離線模式：SW 快取生效後，離線 reload 頁面仍可正常載入', async ({ page, context }) => {
    // 先正常載入一次，讓 install 事件把 precache 清單存進快取
    await page.goto('/index.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // 保險起見等一輪 microtask/event loop，確保 install 內的 cache.addAll 已完成
    await page.waitForTimeout(500);

    // 切離線後重新整理
    await context.setOffline(true);
    await page.reload();

    // 頁面仍應正常載入（不是瀏覽器的離線錯誤頁），關鍵 DOM 元素與標題都要在
    await expect(page).toHaveTitle('圖片拼接工具 - 手動裁切版');
    await expect(page.locator('#fileInput')).toBeAttached();
    await expect(page.locator('.upload-area')).toBeVisible();

    await context.setOffline(false);
  });

  test('離線模式：上傳圖片＋拼接功能全程可用（純前端邏輯，不需要網路）', async ({ page, context }) => {
    await page.goto('/index.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForTimeout(500);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.upload-area')).toBeVisible();

    const solidPng = makeSolidPng(120, 90, [10, 200, 90]);
    await page.setInputFiles('#fileInput', [
      { name: 'offline-test.png', mimeType: 'image/png', buffer: solidPng },
    ]);
    await page.waitForSelector('.crop-selection');
    await page.waitForFunction(() => {
      // @ts-ignore
      const cd = window.cropData;
      return cd && cd[0] && cd[0].cropRect;
    });
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });
    const width = await page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement) => c.width);
    expect(width).toBeGreaterThan(0);

    await context.setOffline(false);
  });

  test('Service Worker 快取版本號（CACHE_NAME）測試前後一致，且測試不變動 sw.js／manifest.json', async ({ page, context }) => {
    // 先記錄原始檔案內容，證明這輪測試本身沒有動到這兩個受保護的檔案
    const swPath = path.resolve(__dirname, '..', 'sw.js');
    const manifestPath = path.resolve(__dirname, '..', 'manifest.json');
    const swBefore = fs.readFileSync(swPath, 'utf-8');
    const manifestBefore = fs.readFileSync(manifestPath, 'utf-8');

    await page.goto('/index.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForTimeout(500);
    const cacheNamesBefore = await page.evaluate(() => caches.keys());

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.upload-area')).toBeVisible();
    const cacheNamesAfter = await page.evaluate(() => caches.keys());
    await context.setOffline(false);

    // sw.js 目前的 CACHE_NAME 是 'image-stitcher-toolbox-v1'；離線 reload 前後都應該是同一個版本，
    // 不會憑空冒出新版快取，也不會把舊版清掉又建一個不同名字的
    expect(cacheNamesBefore).toEqual(['image-stitcher-toolbox-v1']);
    expect(cacheNamesAfter).toEqual(['image-stitcher-toolbox-v1']);

    expect(fs.readFileSync(swPath, 'utf-8')).toBe(swBefore);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(manifestBefore);
  });
});
