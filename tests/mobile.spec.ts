import { test, expect } from '@playwright/test';
import path from 'path';
import { makeSolidPng } from './fixtures/pngHelper';

// 手機版面（375px，iPhone SE 尺寸級別）為第一優先場景。
const MOBILE_VIEWPORT = { width: 375, height: 667 };

async function hasHorizontalScroll(page: import('@playwright/test').Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test.describe('手機版面（375px）', () => {
  test('上傳區域可見、拼接按鈕可互動、預覽區不溢出視窗', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('file://' + path.resolve('index.html'));

    const uploadArea = page.locator('.upload-area');
    await expect(uploadArea).toBeVisible();
    const uploadBox = await uploadArea.boundingBox();
    if (!uploadBox) throw new Error('no upload area box');
    expect(uploadBox.x).toBeGreaterThanOrEqual(0);
    expect(uploadBox.x + uploadBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    expect(await hasHorizontalScroll(page)).toBe(false);

    await page.setInputFiles('#fileInput', [
      { name: 'm1.png', mimeType: 'image/png', buffer: makeSolidPng(300, 200, [200, 50, 50]) },
      { name: 'm2.png', mimeType: 'image/png', buffer: makeSolidPng(300, 200, [50, 50, 200]) },
    ]);
    await page.waitForSelector('.crop-selection');

    // 拼接按鈕應可見、可點擊互動（未鎖定狀態）
    const processBtn = page.locator('#processBtn');
    await expect(processBtn).toBeVisible();
    await expect(processBtn).toBeEnabled();
    const btnBox = await processBtn.boundingBox();
    if (!btnBox) throw new Error('no process button box');
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    // 預覽區（每張圖的裁切預覽）不應溢出視窗寬度
    const previews = page.locator('.image-preview');
    const count = await previews.count();
    expect(count).toBe(2);
    for (let i = 0; i < count; i++) {
      const box = await previews.nth(i).boundingBox();
      if (!box) throw new Error('no preview box at ' + i);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }
    expect(await hasHorizontalScroll(page)).toBe(false);

    // 拼接按鈕真的可互動：點下去應正常跑完，不是視覺上看得到但點不動
    await processBtn.click();
    await page.waitForSelector('#resultArea', { state: 'visible' });
    const width = await page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement) => c.width);
    expect(width).toBeGreaterThan(0);
  });

  test('檔名含中文＋空白＋特殊字元不破版（無橫向捲動，檔名正確跳脫顯示）', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('file://' + path.resolve('index.html'));

    const weirdName = '測試 截圖 (1)#特殊.png';
    await page.setInputFiles('#fileInput', [
      { name: weirdName, mimeType: 'image/png', buffer: makeSolidPng(200, 150, [80, 180, 80]) },
    ]);
    await page.waitForSelector('.crop-name');

    expect(await hasHorizontalScroll(page)).toBe(false);

    const nameText = await page.locator('.crop-name').first().textContent();
    expect(nameText).toContain(weirdName);

    // crop-name 本身不應撐出視窗寬度（word-break: break-all 是既有樣式，確認沒有被移除）
    const nameBox = await page.locator('.crop-name').first().boundingBox();
    if (!nameBox) throw new Error('no crop-name box');
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test('escapeHtml 防 XSS 迴歸（<img onerror> 變種，非既有測試涵蓋的 <script> payload）', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const alerts: string[] = [];
    page.on('dialog', async (dialog) => {
      alerts.push(dialog.message());
      await dialog.dismiss();
    });

    await page.goto('file://' + path.resolve('index.html'));
    const maliciousName = '<img src=x onerror=alert(1)>.png';
    await page.setInputFiles('#fileInput', [
      { name: maliciousName, mimeType: 'image/png', buffer: makeSolidPng(100, 100, [10, 10, 10]) },
    ]);
    await page.waitForSelector('.crop-name');
    // 給 onerror 一點時間，確保萬一真的被當成 HTML 執行，alert 有機會被觸發
    await page.waitForTimeout(300);

    expect(alerts.length).toBe(0);
    expect(await hasHorizontalScroll(page)).toBe(false);

    const nameText = await page.locator('.crop-name').first().textContent();
    expect(nameText).toContain(maliciousName);

    // 不應該真的產生一個 <img onerror> 元素（代表沒被當成 HTML 解析執行）
    const injectedImgCount = await page.locator('.crop-name img').count();
    expect(injectedImgCount).toBe(0);

    const innerHtml = await page.locator('.crop-name').first().evaluate((el) => el.innerHTML);
    expect(innerHtml).toContain('&lt;img');
    expect(innerHtml).not.toContain('<img');
  });
});
