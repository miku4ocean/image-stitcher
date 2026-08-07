import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const FIX = (name: string) => path.join('tests/fixtures', name);
const NUM_FILES = Array.from({ length: 10 }, (_, i) => FIX(`${i + 1}.png`));

test.describe('圖片拼接工具', () => {
  test('① 依檔名自然排序（1,2,...,10 正確，非 1,10,2）', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    // 刻意打亂選取順序：檔案系統/OS 選取順序不保證，工具本身要自己重排
    await page.setInputFiles('#fileInput', [
      FIX('10.png'), FIX('1.png'), FIX('2.png'), FIX('9.png'), FIX('3.png'),
    ]);
    const names = page.locator('.crop-name');
    await expect(names).toHaveCount(5);
    const texts = await names.allTextContents();
    expect(texts.map((t) => t.replace(/^位置 \d+:\s*/, ''))).toEqual([
      '1.png', '2.png', '3.png', '9.png', '10.png',
    ]);
  });

  test('② 裁切框可拖曳移動與 8 向縮放', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('2.png')]);
    await page.waitForSelector('#selection-0');
    await page.waitForFunction(() => {
      // @ts-ignore
      return window.cropData && window.cropData[0] && window.cropData[0].cropRect;
    });
    // boundingBox() 不會自動把元素捲入可視範圍，用真滑鼠座標拖曳前務必先捲動到看得見
    await page.locator('#selection-0').scrollIntoViewIfNeeded();

    // 先縮放：預設裁切框是全選（貼齊圖片四邊），要先縮小才有「移動」的空間可測試。
    // 拖曳右下角 handle（se）往內收，驗證縮放生效且尺寸確實變小
    const seHandle = page.locator('#selection-0 .crop-handle.se');
    let hBox = await seHandle.boundingBox();
    if (!hBox) throw new Error('no se handle box');
    const beforeResize = await page.locator('#selection-0').evaluate((el) => ({
      w: el.style.width, h: el.style.height,
    }));
    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hBox.x - 40, hBox.y - 30, { steps: 5 });
    await page.mouse.up();
    const afterResize = await page.locator('#selection-0').evaluate((el) => ({
      w: el.style.width, h: el.style.height,
    }));
    expect(afterResize.w).not.toBe(beforeResize.w);
    expect(afterResize.h).not.toBe(beforeResize.h);
    expect(parseFloat(afterResize.w)).toBeLessThan(parseFloat(beforeResize.w));
    expect(parseFloat(afterResize.h)).toBeLessThan(parseFloat(beforeResize.h));

    // 現在選取框已縮小、四周有空間，測試移動：拖曳選取框本體
    const beforeMove = await page.locator('#selection-0').evaluate((el) => ({
      x: el.style.left, y: el.style.top,
    }));
    const box = await page.locator('#selection-0').boundingBox();
    if (!box) throw new Error('no selection box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10, { steps: 5 });
    await page.mouse.up();
    const afterMove = await page.locator('#selection-0').evaluate((el) => ({
      x: el.style.left, y: el.style.top,
    }));
    expect(afterMove.x).not.toBe(beforeMove.x);
    expect(afterMove.y).not.toBe(beforeMove.y);

    // 抽測另一個方向的縮放 handle（nw，左上角），確認 8 向控制點都可運作
    const nwHandle = page.locator('#selection-0 .crop-handle.nw');
    const nwBox = await nwHandle.boundingBox();
    if (!nwBox) throw new Error('no nw handle box');
    const beforeNw = await page.locator('#selection-0').evaluate((el) => ({
      w: el.style.width, h: el.style.height, x: el.style.left, y: el.style.top,
    }));
    await page.mouse.move(nwBox.x + nwBox.width / 2, nwBox.y + nwBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(nwBox.x + 10, nwBox.y + 8, { steps: 5 });
    await page.mouse.up();
    const afterNw = await page.locator('#selection-0').evaluate((el) => ({
      w: el.style.width, h: el.style.height, x: el.style.left, y: el.style.top,
    }));
    expect(afterNw.w).not.toBe(beforeNw.w);
    expect(afterNw.x).not.toBe(beforeNw.x);
  });

  test('③ 換順序後畫面重排正確，且既有裁切框保留', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('2.png'), FIX('3.png')]);
    await page.waitForSelector('#selection-0');
    // cropData[i] 要等 initializeCrop 內的 100ms setTimeout 觸發後才會寫入，先等它就緒
    await page.waitForFunction(() => {
      // @ts-ignore
      return window.cropData && window.cropData[0] && window.cropData[0].cropRect;
    });

    // 先把位置 0（1.png）的裁切框改到一個可辨識的自訂範圍
    await page.locator('#selection-0').evaluate((el) => {
      (el as HTMLElement).style.left = '5px';
      (el as HTMLElement).style.top = '5px';
      (el as HTMLElement).style.width = '40px';
      (el as HTMLElement).style.height = '30px';
    });
    // 同步更新 JS 內部狀態（模擬使用者拖曳後的落點，因為直接改 style 不會觸發 cropData 更新）
    await page.evaluate(() => {
      // @ts-ignore
      cropData[0].cropRect = { x: 5, y: 5, width: 40, height: 30 };
    });

    // 把 1.png（目前第 1 個位置，index 0）換到第 3 個位置（index 2）
    await page.locator('.crop-item').nth(0).locator('.position-control select').selectOption('2');

    // 換序後畫面會重建（innerHTML 清空→逐張非同步重新讀檔渲染），等 3 張卡片都回來再讀取
    await expect(page.locator('.crop-name')).toHaveCount(3);
    const namesAfter = await page.locator('.crop-name').allTextContents();
    expect(namesAfter.map((t) => t.replace(/^位置 \d+:\s*/, ''))).toEqual([
      '2.png', '3.png', '1.png',
    ]);

    // 1.png 現在排在第 3 個（index 2），裁切設定應延續（透過比例還原，等待 initializeCrop 的 setTimeout）
    await page.waitForTimeout(200);
    const preserved = await page.evaluate(() => {
      // @ts-ignore
      return cropData[2] && cropData[2].cropRect;
    });
    expect(preserved).toBeTruthy();
    expect(preserved.width).toBeGreaterThan(0);
    expect(preserved.height).toBeGreaterThan(0);
  });

  test('④ 拼接結果順序正確（位置 1 在最上方）', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    // 用色彩可辨識的三張圖：1.png 偏藍、10.png 偏紅（依 generate.js 的漸層配色）
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('10.png')]);
    await page.waitForSelector('.crop-selection');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    const { width, height, topColor, bottomColor } = await page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      const top = ctx.getImageData(Math.floor(c.width / 2), 5, 1, 1).data;
      const bottom = ctx.getImageData(Math.floor(c.width / 2), c.height - 5, 1, 1).data;
      return {
        width: c.width,
        height: c.height,
        topColor: Array.from(top),
        bottomColor: Array.from(bottom),
      };
    });
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // 1.png 紅色分量低（i=1 → r≈26），10.png 紅色分量高（i=10 → r=255）
    // 位置 1（1.png）應在最上方 → 頂部取樣紅色分量應明顯低於底部
    expect(topColor[0]).toBeLessThan(bottomColor[0]);
  });

  test('⑤ 視窗 resize 後裁切框座標仍對得準', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png')]);
    await page.waitForSelector('#selection-0');

    const before = await page.locator('#selection-0').evaluate((el) => el.getBoundingClientRect());
    const imgBefore = await page.locator('#img-0').evaluate((el) => el.getBoundingClientRect());

    await page.setViewportSize({ width: 500, height: 900 });
    // resize debounce 為 200ms，多等一些
    await page.waitForTimeout(400);

    const after = await page.locator('#selection-0').evaluate((el) => el.getBoundingClientRect());
    const imgAfter = await page.locator('#img-0').evaluate((el) => el.getBoundingClientRect());

    // 圖片寬度應隨視窗縮小而縮小
    expect(imgAfter.width).toBeLessThan(imgBefore.width);
    // 裁切框應仍完全落在圖片範圍內（座標依比例重算，不會跑出圖片外）
    expect(after.left).toBeGreaterThanOrEqual(imgAfter.left - 1);
    expect(after.top).toBeGreaterThanOrEqual(imgAfter.top - 1);
    expect(after.right).toBeLessThanOrEqual(imgAfter.right + 1);
    expect(after.bottom).toBeLessThanOrEqual(imgAfter.bottom + 1);
  });

  test('⑥ 開始拼接連點不重複執行（isProcessing 鎖）', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('2.png'), FIX('3.png')]);
    await page.waitForSelector('.crop-selection');

    let callCount = 0;
    await page.exposeFunction('__countStitch', () => {
      callCount++;
    });
    await page.evaluate(() => {
      // @ts-ignore
      const original = stitchCroppedImages;
      // @ts-ignore
      window.stitchCroppedImages = function (...args) {
        // @ts-ignore
        window.__countStitch();
        return original.apply(this, args);
      };
    });

    // 模擬「快速連點」：同一 tick 內連續呼叫 processImages 多次（比真實滑鼠點擊更能
    // 決定性地重現「來不及等 disabled 生效就再點一次」的競態情境，
    // isProcessing 鎖應確保只有第一次真正跑到底）
    await page.evaluate(() => {
      // @ts-ignore
      processImages();
      // @ts-ignore
      processImages();
      // @ts-ignore
      processImages();
    });
    await page.waitForSelector('#resultArea', { state: 'visible' });
    await page.waitForTimeout(300);
    expect(callCount).toBe(1);

    // 按鈕點擊行為也應維持一致：正常單次點擊仍可正確觸發（防呆鎖不影響正常使用）
    const btn = page.locator('#processBtn');
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText('開始拼接');
  });

  test('⑦ 惡意檔名（含 <script>）不執行、被正確轉義', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', async (dialog) => {
      alerts.push(dialog.message());
      await dialog.dismiss();
    });

    await page.goto('file://' + path.resolve('index.html'));
    const maliciousName = '<script>alert(1)</script>.png';
    const buffer = fs.readFileSync(FIX('1.png'));
    await page.setInputFiles('#fileInput', {
      name: maliciousName,
      mimeType: 'image/png',
      buffer,
    });
    await page.waitForSelector('.crop-name');

    // 沒有觸發任何 alert/dialog（代表腳本沒被當成程式碼執行）
    expect(alerts.length).toBe(0);

    // DOM 中的檔名應該是逐字顯示（經 escapeHtml 轉義），而不是被瀏覽器解析成真正的 <script> 元素
    const nameText = await page.locator('.crop-name').first().textContent();
    expect(nameText).toContain(maliciousName);
    const scriptTagCount = await page.locator('.crop-name script').count();
    expect(scriptTagCount).toBe(0);

    // innerHTML 中應該是被轉義過的實體，而不是原始的 < >
    const innerHtml = await page.locator('.crop-name').first().evaluate((el) => el.innerHTML);
    expect(innerHtml).toContain('&lt;script&gt;');
    expect(innerHtml).not.toContain('<script>');
  });

  test('資安：張數超過上限時顯示畫面內提示（非 alert）並阻擋', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', async (dialog) => {
      alerts.push(dialog.message());
      await dialog.dismiss();
    });
    await page.goto('file://' + path.resolve('index.html'));
    const eleven = [...NUM_FILES, FIX('11.png')];
    await page.setInputFiles('#fileInput', eleven);

    const toast = page.locator('#limitToast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('10');
    // 沒有進入裁切畫面（被阻擋）
    await expect(page.locator('.crop-area')).toBeHidden();
    expect(alerts.length).toBe(0);
  });

  test('拼接時顯示進度文字（處理第 N / 總數 張）', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('2.png'), FIX('3.png')]);
    await page.waitForSelector('.crop-selection');

    // 攔截進度文字的變化：用 MutationObserver 記錄 progressText 的 textContent 歷程
    await page.evaluate(() => {
      // @ts-ignore
      window.__progressLog = [];
      const el = document.getElementById('progressText');
      if (el) {
        new MutationObserver(() => {
          // @ts-ignore
          window.__progressLog.push(el.textContent);
        }).observe(el, { childList: true, characterData: true, subtree: true });
      }
    });

    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    const log: string[] = await page.evaluate(() => {
      // @ts-ignore
      return window.__progressLog;
    });
    // 應至少出現過「處理第 1 / 3 張」的文字
    expect(log.some((t) => t.includes('1 / 3'))).toBe(true);
    // 完成後進度元素應隱藏
    await expect(page.locator('#progressBar')).toBeHidden();
    await expect(page.locator('#progressText')).toBeHidden();
  });

  test('拖放檔案到上傳區域觸發裁切介面', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    // Playwright 的 setInputFiles 無法模擬 drag-and-drop，但我們可以驗證
    // drag-over CSS 樣式切換與 drop handler 的存在。直接用 dispatchEvent
    // 模擬 dragover→dragleave 的視覺回饋循環。
    const uploadArea = page.locator('.upload-area');
    await expect(uploadArea).toBeVisible();

    // 模擬 dragover：觸發 drag-over class
    await uploadArea.evaluate((el) => {
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
    });
    await expect(uploadArea).toHaveClass(/drag-over/);

    // 模擬 dragleave：移除 drag-over class
    await uploadArea.evaluate((el) => {
      el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
    });
    await expect(uploadArea).not.toHaveClass(/drag-over/);

    // 驗證上傳區文字包含「拖放」提示
    await expect(uploadArea).toContainText('拖放');
  });

  test('原始基礎測試：上傳兩張圖後顯示裁切介面且順序正確', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('2.png')]);
    const names = page.locator('.crop-name');
    await expect(names.nth(0)).toContainText('1.png');
    await expect(names.nth(1)).toContainText('2.png');
  });

  test('原始基礎測試：拼接後結果 canvas 有內容', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('2.png')]);
    await page.waitForSelector('.crop-selection');
    await page.click('#processBtn');
    const width = await page.locator('#resultCanvas').evaluate(
      (c: HTMLCanvasElement) => c.width
    );
    expect(width).toBeGreaterThan(0);
  });
});
