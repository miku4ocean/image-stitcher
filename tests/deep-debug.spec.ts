import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { makeSolidPng, makeHorizontalSplitPng } from './fixtures/pngHelper';

// 首輪深度偵錯（擬真品質測試）：以下每一條都對應一個「build/lint/test 全綠、但產品其實壞掉」的真 bug，
// 都是先寫出會紅的測試證明症狀存在，再修 index.html 讓它變綠。
// 驗證一律看真實產出（Canvas getImageData 取像素、實際下載檔案、真滑鼠事件、實測版面矩形），
// 不是只看有沒有拋錯。

const PAGE = () => 'file://' + path.resolve('index.html');

/** 等待每一張圖的裁切資料都初始化完成。
 *  注意：不能用 cropData.every()——setupCropInterface 先建立的是 `new Array(n)` 稀疏陣列，
 *  every() 會跳過空洞直接回傳 true，等於沒等到（既有測試的 helper 有這個問題）。 */
async function waitAllCropsReady(page: import('@playwright/test').Page, count: number) {
  await page.waitForFunction((n) => {
    const cd = (window as any).cropData;
    if (!cd || cd.length !== n) return false;
    for (let i = 0; i < n; i++) if (!cd[i] || !cd[i].cropRect) return false;
    return true;
  }, count);
}

/** 取樣結果畫布的像素（超出範圍會自動夾限）。 */
async function samplePixels(page: import('@playwright/test').Page, points: [number, number][]) {
  return page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement, pts: [number, number][]) => {
    const ctx = c.getContext('2d')!;
    return {
      width: c.width,
      height: c.height,
      pixels: pts.map(([x, y]) => {
        const cx = Math.min(c.width - 1, Math.max(0, Math.round(x)));
        const cy = Math.min(c.height - 1, Math.max(0, Math.round(y)));
        return Array.from(ctx.getImageData(cx, cy, 1, 1).data);
      }),
    };
  }, points);
}

/** 把元素捲到畫面中段，確保用真滑鼠座標往上／往左拖曳時有足夠空間（不會被視窗邊界吃掉）。 */
async function centerInViewport(page: import('@playwright/test').Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const vp = page.viewportSize()!;
  const box = (await page.locator(selector).boundingBox())!;
  const delta = Math.round(box.y - vp.height * 0.45);
  if (Math.abs(delta) > 10) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(150);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bug①：輸出畫布超過瀏覽器上限時「靜默」變成一張全空白的圖
// ─────────────────────────────────────────────────────────────────────────────
// 4 張 300x2200 的窄長圖（每張 0.66MP、合計 2.6MP，遠低於工具自己的 MAX_SINGLE_PIXELS/
// MAX_TOTAL_PIXELS 上限，張數也只有 4），用「預設」的輸出設定「固定寬度 3000px」拼接，
// scaleFactor = 3000/300 = 10 → 畫布 3000 x 88000。Chromium 單邊上限實測為 65535
// （65536 就爆），超過時 canvas.width/height 讀起來仍是設定值、fillRect/drawImage 也不會拋錯，
// 但整張畫布的像素全是透明 (0,0,0,0)，toBlob 回傳 null ——
// 使用者看到的是「拼接成功、結果區一片空白、按下載完全沒反應、沒有任何錯誤訊息」。
const TALL = [
  { name: 't1.png', rgb: [255, 0, 0] as [number, number, number] },
  { name: 't2.png', rgb: [0, 255, 0] as [number, number, number] },
  { name: 't3.png', rgb: [0, 0, 255] as [number, number, number] },
  { name: 't4.png', rgb: [255, 255, 0] as [number, number, number] },
];
const TALL_W = 300;
const TALL_H = 2200;
function tallFiles() {
  return TALL.map((t) => ({ name: t.name, mimeType: 'image/png', buffer: makeSolidPng(TALL_W, TALL_H, t.rgb) }));
}

test.describe('深度偵錯（首輪）', () => {
  test('bug①：窄長圖 + 預設「固定寬度 3000px」時，輸出畫布不得超過瀏覽器上限而變成全空白', async ({ page }) => {
    await page.goto(PAGE());
    await page.setInputFiles('#fileInput', tallFiles());
    await page.waitForSelector('.crop-selection');
    await waitAllCropsReady(page, 4);
    // 不動輸出設定，用預設值（HTML 的 selected 是「固定寬度 3000px」）
    expect(await page.locator('#outputMode').inputValue()).toBe('3000px');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    // 取樣點用「畫布比例」表示，因為修好之後畫布尺寸會被自動縮小，不宜硬寫死
    const sampled = await page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      const px = (fx: number, fy: number) => {
        const x = Math.min(c.width - 1, Math.max(0, Math.round(c.width * fx)));
        const y = Math.min(c.height - 1, Math.max(0, Math.round(c.height * fy)));
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      };
      return {
        width: c.width,
        height: c.height,
        bands: [px(0.5, 0.125), px(0.5, 0.375), px(0.5, 0.625), px(0.5, 0.875)],
      };
    });

    // 畫布尺寸必須落在瀏覽器真的畫得出來的範圍內（實測：單邊 65535、總面積 2^28）
    expect(sampled.width).toBeLessThanOrEqual(65535);
    expect(sampled.height).toBeLessThanOrEqual(65535);
    expect(sampled.width * sampled.height).toBeLessThanOrEqual(268435456);
    // 長寬比要維持（縮小是等比例的，不是把圖壓扁）
    expect(sampled.width / sampled.height).toBeCloseTo(TALL_W / (TALL_H * 4), 3);
    // 關鍵：四個色帶必須真的畫得出來，而不是全透明的空畫布
    expect(sampled.bands[0].slice(0, 3)).toEqual([255, 0, 0]);
    expect(sampled.bands[1].slice(0, 3)).toEqual([0, 255, 0]);
    expect(sampled.bands[2].slice(0, 3)).toEqual([0, 0, 255]);
    expect(sampled.bands[3].slice(0, 3)).toEqual([255, 255, 0]);
    expect(sampled.bands.every((p) => p[3] === 255)).toBe(true);
    // 自動縮小時要讓使用者知道（不是默默改掉輸出尺寸）
    await expect(page.locator('#limitToast')).toBeVisible();
    expect(await page.locator('#limitToast').textContent()).toContain('縮小');
  });

  test('bug①：同一情境下「下載圖片」必須真的產出非空的 PNG 檔（原本 toBlob 回 null，按了毫無反應）', async ({ page }) => {
    await page.goto(PAGE());
    await page.setInputFiles('#fileInput', tallFiles());
    await page.waitForSelector('.crop-selection');
    await waitAllCropsReady(page, 4);
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#downloadBtn'),
    ]);
    const p = await download.path();
    expect(p).toBeTruthy();
    expect(fs.statSync(p!).size).toBeGreaterThan(1000);
  });

  test('bug①：toBlob 失敗時「下載圖片」要明講失敗，不能按了毫無反應（錯誤路徑不得靜默吞掉）', async ({ page }) => {
    await page.goto(PAGE());
    await page.setInputFiles('#fileInput', [
      { name: 'ok.png', mimeType: 'image/png', buffer: makeSolidPng(100, 100, [255, 0, 0]) },
    ]);
    await page.waitForSelector('.crop-selection');
    await waitAllCropsReady(page, 1);
    await page.selectOption('#outputMode', 'original');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    // 決定性地重現 toBlob 失敗（真實情境是畫布過大導致編碼失敗，無法穩定重現，故直接注入）
    await page.evaluate(() => {
      const c = document.getElementById('resultCanvas') as HTMLCanvasElement;
      c.toBlob = function (cb: BlobCallback) { cb(null); };
    });
    await page.click('#downloadBtn');
    await expect(page.locator('#limitToast')).toBeVisible();
    expect(await page.locator('#limitToast').textContent()).toContain('產生失敗');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // bug②：裁切框可以被拖出圖片邊界，產出多出一條「幽靈空白帶」
  // ───────────────────────────────────────────────────────────────────────────
  // handleDrag 的 n/nw/ne 只夾限 y、w/nw/sw 只夾限 x，寬高卻用 `width - dx` 無上限地增加，
  // 所以在預設「全選」狀態下把上緣把手往上拖（很自然的動作：想確認整個上緣都框到），
  // 裁切框高度就會超出圖片下緣。cropAndLoadImage 依這個尺寸開畫布、drawImage 的來源矩形
  // 超出圖片範圍的部分是空的 → 最終拼接圖多一條白帶，且「選取區域」資訊會顯示比原圖還大的尺寸。
  test('bug②：上緣把手往上拖，裁切框不得超出圖片下緣（產出不得出現幽靈白帶）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(PAGE());
    await page.setInputFiles('#fileInput', [
      { name: 'split.png', mimeType: 'image/png', buffer: makeHorizontalSplitPng(200, 200, [255, 0, 0], [0, 0, 255], 100) },
    ]);
    await page.waitForSelector('.crop-selection');
    await waitAllCropsReady(page, 1);
    await centerInViewport(page, '#selection-0');

    const box = (await page.locator('#selection-0 .crop-handle.n').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 100, { steps: 8 });
    await page.mouse.up();

    const data = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).cropData[0])));
    // 裁切框永遠要落在圖片範圍內
    expect(data.cropRect.y).toBeGreaterThanOrEqual(0);
    expect(data.cropRect.y + data.cropRect.height).toBeLessThanOrEqual(data.displayHeight + 0.5);
    // 資訊列不該顯示比來源圖還大的裁切尺寸
    expect(await page.locator('#info-0').textContent()).toContain('200 x 200 px');

    await page.selectOption('#outputMode', 'original');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });
    const out = await samplePixels(page, [[100, 5], [100, 150], [100, 197]]);
    expect(out.width).toBe(200);
    expect(out.height).toBe(200);
    expect(out.pixels[0].slice(0, 3)).toEqual([255, 0, 0]);   // 上半紅
    expect(out.pixels[1].slice(0, 3)).toEqual([0, 0, 255]);   // 下半藍
    expect(out.pixels[2].slice(0, 3)).toEqual([0, 0, 255]);   // 下緣仍是藍，不是白帶
  });

  test('bug②：左緣把手往左拖（375px 手機）裁切框不得超出圖片右緣，往內拖則要正常縮小且右緣固定', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PAGE());
    await page.setInputFiles('#fileInput', [
      { name: 'solid.png', mimeType: 'image/png', buffer: makeSolidPng(200, 200, [255, 0, 0]) },
    ]);
    await page.waitForSelector('.crop-selection');
    await waitAllCropsReady(page, 1);
    await centerInViewport(page, '#selection-0');

    const before = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).cropData[0])));
    // ① 往左拖出圖片外：寬度不得超出圖片
    let box = (await page.locator('#selection-0 .crop-handle.w').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const afterOut = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).cropData[0].cropRect)));
    expect(afterOut.x).toBeGreaterThanOrEqual(0);
    expect(afterOut.x + afterOut.width).toBeLessThanOrEqual(before.displayWidth + 0.5);

    // ② 往內（右）拖：仍要能正常縮小，且右緣固定不動——確認修正不是把把手鎖死
    const right = afterOut.x + afterOut.width;
    box = (await page.locator('#selection-0 .crop-handle.w').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const afterIn = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).cropData[0].cropRect)));
    expect(afterIn.x).toBeGreaterThan(afterOut.x + 20);
    expect(afterIn.width).toBeLessThan(afterOut.width - 20);
    expect(afterIn.x + afterIn.width).toBeCloseTo(right, 0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // bug③：totalPixelSum 只加不減，重新選檔會被自己的舊帳誤擋
  // ───────────────────────────────────────────────────────────────────────────
  // handleFiles 是「整批取代」（selectedFiles = files、cropData = []），但 checkAndAddFiles 內的
  // totalPixelSum 卻只累加不歸零。上傳區塊自始至終都在畫面上、隨時可以再選一批，
  // 所以重選幾輪之後，即使目前畫面上只有幾張小圖，也會被「圖片總像素過大」擋下來。
  test('bug③：重新選一批圖片後總像素應重新計算，不會被上一批的舊帳誤擋', async ({ page }) => {
    await page.goto(PAGE());
    // 4000x4000 = 16MP，剛好等於 MAX_SINGLE_PIXELS（檢查是 `>` 所以可通過）；
    // 三張 = 48MP，低於 MAX_TOTAL_PIXELS(80MP)。同一份 buffer 重複使用，只編碼一次。
    const big = makeSolidPng(4000, 4000, [200, 40, 40]);
    const batch1 = ['a1.png', 'a2.png', 'a3.png'].map((name) => ({ name, mimeType: 'image/png', buffer: big }));
    const batch2 = ['b1.png', 'b2.png', 'b3.png'].map((name) => ({ name, mimeType: 'image/png', buffer: big }));

    await page.setInputFiles('#fileInput', batch1);
    await page.waitForFunction(() => (window as any).selectedFiles.length === 3);
    expect(await page.evaluate(() => (window as any).totalPixelSum)).toBe(48000000);

    // 直接再選第二批（整批取代，不是「新增更多圖片」）
    await page.setInputFiles('#fileInput', batch2);
    await page.waitForTimeout(1500);

    // 第二批只有 48MP，遠低於 80MP 上限，必須順利換成新的三張
    expect(await page.locator('#limitToast').isVisible()).toBe(false);
    expect(await page.evaluate(() => (window as any).totalPixelSum)).toBe(48000000);
    const names = (await page.locator('.crop-name').allTextContents()).map((t) => t.replace(/^位置 \d+:\s*/, ''));
    expect(names).toEqual(['b1.png', 'b2.png', 'b3.png']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // bug④：壞掉的圖片被靜默略過，使用者不知道成品少了一張
  // ───────────────────────────────────────────────────────────────────────────
  // 損毀／不支援的圖片：卡片永遠停在「選取區域：等待圖片載入...」（img.onerror 沒被處理），
  // 拼接時 cropAndLoadImage 回 null 被跳過，只有 console.warn，畫面上完全沒有提示——
  // 使用者拿到的是「少了一張、但看起來很正常」的拼接結果。
  test('bug④：部分圖片損毀時，卡片要標示錯誤、拼接完要提示略過張數（不能靜默吞掉）', async ({ page }) => {
    await page.goto(PAGE());
    await page.setInputFiles('#fileInput', [
      { name: 'ok1.png', mimeType: 'image/png', buffer: makeSolidPng(100, 100, [255, 0, 0]) },
      { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('this is not a png at all') },
      { name: 'ok2.png', mimeType: 'image/png', buffer: makeSolidPng(100, 100, [0, 0, 255]) },
    ]);
    await page.waitForSelector('.crop-selection');
    await page.waitForTimeout(600);

    // 壞掉那張的卡片要看得出來壞了，不能停在「等待圖片載入...」
    // （檔名會自然排序，broken.png 會排到第一張，所以用「卡片內含該檔名」定位而不是靠索引）
    expect(await page.locator('.crop-info').count()).toBe(3);
    const brokenInfo = page.locator('.crop-item', { hasText: 'broken.png' }).locator('.crop-info');
    const brokenText = (await brokenInfo.textContent()) || '';
    expect(brokenText).not.toContain('等待圖片載入');
    expect(brokenText).toContain('無法讀取');

    await page.selectOption('#outputMode', 'original');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    // 產出只有兩張（紅、藍），且要明確告知有一張被略過
    const out = await samplePixels(page, [[50, 20], [50, 150]]);
    expect(out.width).toBe(100);
    expect(out.height).toBe(200);
    expect(out.pixels[0].slice(0, 3)).toEqual([255, 0, 0]);
    expect(out.pixels[1].slice(0, 3)).toEqual([0, 0, 255]);
    await expect(page.locator('#limitToast')).toBeVisible();
    const toast = (await page.locator('#limitToast').textContent()) || '';
    expect(toast).toContain('1');
    expect(toast).toContain('略過');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // bug⑤：預覽圖被拉伸變形，裁切時根本看不出自己在裁什麼
  // ───────────────────────────────────────────────────────────────────────────
  // .preview-img 同時有 width:100% 與 max-height:400px：width 是「確定值」，
  // max-height 只把高度砍到 400，寬度不會等比例縮 → 圖片被硬拉成容器寬 x 400。
  // 實測 1170x2532 的手機截圖（本工具最主要的使用情境）在桌面會被畫成 1132x400，
  // 長寬比 0.46 → 2.83，橫向拉伸約 6 倍。裁切結果的換算是分軸的所以數字仍正確，
  // 但使用者是「看著一張變形的圖」在拉裁切框，這是裁切工具的核心體驗壞掉。
  for (const vp of [{ width: 1280, height: 900, label: '桌面 1280px' }, { width: 375, height: 800, label: '手機 375px' }]) {
    test(`bug⑤：預覽圖要維持來源長寬比、裁切框要精準貼齊圖片（${vp.label}）`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(PAGE());
      const cases = [
        { name: 'p1-square.png', w: 200, h: 200 },
        { name: 'p2-phone.png', w: 1170, h: 2532 },
        { name: 'p3-wide.png', w: 1600, h: 400 },
      ];
      await page.setInputFiles(
        '#fileInput',
        cases.map((c) => ({ name: c.name, mimeType: 'image/png', buffer: makeSolidPng(c.w, c.h, [180, 60, 60]) }))
      );
      await page.waitForSelector('.crop-selection');
      await waitAllCropsReady(page, cases.length);

      const measured = await page.evaluate((n) => {
        const rows: any[] = [];
        for (let i = 0; i < n; i++) {
          const img = document.getElementById('img-' + i) as HTMLImageElement;
          const sel = document.getElementById('selection-' + i) as HTMLElement;
          const ir = img.getBoundingClientRect();
          const sr = sel.getBoundingClientRect();
          rows.push({
            naturalRatio: img.naturalWidth / img.naturalHeight,
            renderedRatio: ir.width / ir.height,
            renderedWidth: ir.width,
            selDx: sr.left - ir.left,
            selDy: sr.top - ir.top,
            selDw: sr.width - ir.width,
            selDh: sr.height - ir.height,
          });
        }
        return rows;
      }, cases.length);

      for (let i = 0; i < cases.length; i++) {
        const m = measured[i];
        // 長寬比不得被拉伸（容許 2% 誤差）
        expect(Math.abs(m.renderedRatio - m.naturalRatio) / m.naturalRatio).toBeLessThan(0.02);
        // 預設全選的裁切框要精準疊在圖片上（避免修版面時把 overlay 與圖片錯開）
        expect(Math.abs(m.selDx)).toBeLessThanOrEqual(1);
        expect(Math.abs(m.selDy)).toBeLessThanOrEqual(1);
        expect(Math.abs(m.selDw)).toBeLessThanOrEqual(1);
        expect(Math.abs(m.selDh)).toBeLessThanOrEqual(1);
      }
      // 版面不得溢出（手機優先）
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      ).toBe(false);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 反證鎖定：EXIF 方向其實已經是對的（HANDOFF 列的「已知限制」在現代瀏覽器上不成立）
  // ───────────────────────────────────────────────────────────────────────────
  // HANDOFF／index.html 開頭都寫「無 EXIF 方向處理（iPhone 直拍可能旋轉）」，實測不成立：
  // <img> 解碼預設就是 image-orientation:from-image（Chrome 81+／Safari 13.1+／Firefox 26+），
  // naturalWidth/Height 回傳的是「轉正後」的尺寸，drawImage 的來源座標也是對轉正後的影像取樣，
  // 所以預覽、裁切框換算、最終輸出全都是正的。這條測試把「已經正確」的行為鎖住，
  // 避免日後有人照著那句過時的說明去補一次手動旋轉，反而變成轉兩次。
  test('反證：EXIF Orientation=6 的 JPEG 已被正確轉正（預覽、裁切換算、輸出三者一致，不需也不可再手動旋轉）', async ({ page }) => {
    await page.goto(PAGE());
    // 在頁面內產一張 200x100 的 JPEG：左半紅、右半藍（左右不對稱，轉了看得出來）
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 100;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 100, 100);
      ctx.fillStyle = '#0000ff'; ctx.fillRect(100, 0, 100, 100);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    });
    // 在 Node 端手工插入 EXIF APP1（Orientation=6＝顯示時順時針轉 90 度），零相依
    const jpeg = Buffer.from(b64, 'base64');
    const tiff = Buffer.alloc(10);
    tiff.write('II', 0, 'ascii');       // little endian
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);           // IFD0 位移
    tiff.writeUInt16LE(1, 8);           // 一個 entry
    const entry = Buffer.alloc(12);
    entry.writeUInt16LE(0x0112, 0);     // tag: Orientation
    entry.writeUInt16LE(3, 2);          // type: SHORT
    entry.writeUInt32LE(1, 4);          // count
    entry.writeUInt16LE(6, 8);          // value: 6
    const exifPayload = Buffer.concat([
      Buffer.from('Exif\0\0', 'latin1'), tiff, entry, Buffer.alloc(4),
    ]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(exifPayload.length + 2, 0);
    const withExif = Buffer.concat([
      jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, exifPayload, jpeg.subarray(2),
    ]);

    await page.setInputFiles('#fileInput', [{ name: 'rotated.jpg', mimeType: 'image/jpeg', buffer: withExif }]);
    await page.waitForSelector('.crop-selection');
    await waitAllCropsReady(page, 1);

    // 預覽與 cropData 都應該用「轉正後」的 100x200，而不是檔案裡的 200x100
    const meta = await page.evaluate(() => {
      const img = document.getElementById('img-0') as HTMLImageElement;
      const d = (window as any).cropData[0];
      return { nw: img.naturalWidth, nh: img.naturalHeight, ow: d.originalWidth, oh: d.originalHeight };
    });
    expect([meta.nw, meta.nh]).toEqual([100, 200]);
    expect([meta.ow, meta.oh]).toEqual([100, 200]);

    await page.selectOption('#outputMode', 'original');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });
    const out = await samplePixels(page, [[5, 5], [95, 5], [5, 195], [95, 195]]);
    expect(out.width).toBe(100);
    expect(out.height).toBe(200);
    // 轉正後：上半紅、下半藍（未轉正會是 200x100 的左紅右藍）。JPEG 有失真，用容差比對
    for (const p of [out.pixels[0], out.pixels[1]]) {
      expect(p[0]).toBeGreaterThan(200);
      expect(p[2]).toBeLessThan(60);
    }
    for (const p of [out.pixels[2], out.pixels[3]]) {
      expect(p[2]).toBeGreaterThan(200);
      expect(p[0]).toBeLessThan(60);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // bug⑥：提示訊息裡的檔名被重複跳脫
  // ───────────────────────────────────────────────────────────────────────────
  // showToast 用 textContent 顯示（本來就不會被當 HTML 執行），呼叫端卻又先 escapeHtml 一次，
  // 檔名含 & < > 的使用者會看到 `a&amp;b&lt;c&gt;.png` 這種亂碼。
  test('bug⑥：尺寸過大提示裡的檔名要原樣顯示，不能被重複跳脫成 &amp;', async ({ page }) => {
    await page.goto(PAGE());
    const weird = 'a&b<c>.png';
    // 4100x4100 = 16.81MP > MAX_SINGLE_PIXELS(16MP)，會走「單張尺寸過大」的提示
    await page.setInputFiles('#fileInput', [
      { name: weird, mimeType: 'image/png', buffer: makeSolidPng(4100, 4100, [30, 30, 30]) },
    ]);
    await expect(page.locator('#limitToast')).toBeVisible({ timeout: 15000 });
    const toast = (await page.locator('#limitToast').textContent()) || '';
    expect(toast).toContain(weird);
    expect(toast).not.toContain('&amp;');
    expect(toast).not.toContain('&lt;');
    // 仍然是用 textContent 塞進去的（沒有因此被當成 HTML 解析）
    const html = await page.locator('#limitToast').evaluate((el) => el.innerHTML);
    expect(html).not.toContain('<c>');
  });
});
