import { test, expect } from '@playwright/test';

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
});
