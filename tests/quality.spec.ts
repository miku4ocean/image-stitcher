import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { makeSolidPng } from './fixtures/pngHelper';

// 拼接產出品質（像素級）驗證。
// 實際讀過 index.html 的 stitchCroppedImages()：
//   - 輸出寬度 = 三張裁切後畫布中「最寬」的那張（maxWidth），不是固定寬度、也不是取第一張。
//   - 輸出高度 = 三張裁切後高度總和（scale 前），乘上 outputMode 對應的 scaleFactor。
//   - 每張圖用 x = round((finalWidth - scaledWidth) / 2) 置中，兩側留白（canvas 底色白）。
//   - outputMode：original→scale=1／2x→scale=2／3x→scale=3／3000px→scale=3000/maxWidth。
// 因此下面三張來源圖「刻意設計成不同寬度」（100 / 300 / 150），
// 若三張同寬，「輸出寬度＝最寬那張」這條規則會驗不出來（會變成同義反覆），故意避開。
const RED = { name: 'a-red.png', width: 100, height: 80, rgb: [255, 0, 0] as [number, number, number] };
const GREEN = { name: 'b-green.png', width: 300, height: 40, rgb: [0, 255, 0] as [number, number, number] };
const BLUE = { name: 'c-blue.png', width: 150, height: 60, rgb: [0, 0, 255] as [number, number, number] };
const IMAGES = [RED, GREEN, BLUE];
const MAX_WIDTH = 300; // GREEN 最寬
const TOTAL_HEIGHT = RED.height + GREEN.height + BLUE.height; // 180

function makeInputFiles() {
  return IMAGES.map((img) => ({
    name: img.name,
    mimeType: 'image/png',
    buffer: makeSolidPng(img.width, img.height, img.rgb),
  }));
}

// 三張圖都保留預設「全選」裁切框（不觸碰裁切框）：
// initializeCrop 在無裁切互動時會設 cropRect = 顯示尺寸全選，
// 而 cropAndLoadImage 換算回原始像素用的 scaleX = originalWidth/displayWidth，
// 兩者相乘後 round() 精確等於原始寬高（與畫面實際顯示了多寬完全無關，純代數抵銷），
// 所以可以放心用「已知原始寬高」精確斷言輸出結果，不受版面配置影響。
async function waitAllCropsReady(page: import('@playwright/test').Page, count: number) {
  await page.waitForFunction((n) => {
    // @ts-ignore
    const cd = window.cropData;
    return cd && cd.length === n && cd.every((d: any) => d && d.cropRect);
  }, count);
}

test.describe('拼接產出品質（像素級）', () => {
  const modes: { value: string; label: string; scale: (maxWidth: number) => number }[] = [
    { value: 'original', label: '原始大小 scale=1', scale: () => 1 },
    { value: '2x', label: '2倍品質 scale=2', scale: () => 2 },
    { value: '3x', label: '3倍品質 scale=3', scale: () => 3 },
    { value: '3000px', label: '固定寬度 3000px', scale: (w) => 3000 / w },
  ];

  for (const mode of modes) {
    test(`輸出設定「${mode.label}」：寬度=最寬來源圖、高度=裁切後總和、各色段與置中留白正確`, async ({ page }) => {
      await page.goto('file://' + path.resolve('index.html'));
      await page.setInputFiles('#fileInput', makeInputFiles());
      await page.waitForSelector('.crop-selection');
      await waitAllCropsReady(page, 3);
      await page.selectOption('#outputMode', mode.value);
      await page.click('#processBtn');
      await page.waitForSelector('#resultArea', { state: 'visible' });

      const scaleFactor = mode.scale(MAX_WIDTH);
      const expectedWidth = Math.round(MAX_WIDTH * scaleFactor);
      const expectedHeight = Math.round(TOTAL_HEIGHT * scaleFactor);

      const result = await page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement, args) => {
        const ctx = c.getContext('2d')!;
        function px(x: number, y: number) {
          const cx = Math.min(c.width - 1, Math.max(0, Math.round(x)));
          const cy = Math.min(c.height - 1, Math.max(0, Math.round(y)));
          return Array.from(ctx.getImageData(cx, cy, 1, 1).data);
        }
        return {
          width: c.width,
          height: c.height,
          red: px(args.redX, args.redY),
          green: px(args.greenX, args.greenY),
          blue: px(args.blueX, args.blueY),
          padTop: px(args.padTopX, args.padTopY),
          padBottom: px(args.padBottomX, args.padBottomY),
        };
      }, {
        // 取樣點都刻意距離色段邊界至少數個像素，避免縮放時的邊界內插誤判
        redX: 150 * scaleFactor, redY: 40 * scaleFactor,
        greenX: 150 * scaleFactor, greenY: 100 * scaleFactor,
        blueX: 150 * scaleFactor, blueY: 150 * scaleFactor,
        // 留白取樣點：紅色那一列的左側（紅圖只佔中間 100~200px 寬）、
        // 藍色那一列的右側（藍圖只佔中間 75~225px 寬），兩處都應是畫布底色白色
        padTopX: 10 * scaleFactor, padTopY: 40 * scaleFactor,
        padBottomX: 280 * scaleFactor, padBottomY: 150 * scaleFactor,
      });

      expect(result.width).toBe(expectedWidth);
      expect(result.height).toBe(expectedHeight);
      expect(result.red.slice(0, 3)).toEqual([255, 0, 0]);
      expect(result.green.slice(0, 3)).toEqual([0, 255, 0]);
      expect(result.blue.slice(0, 3)).toEqual([0, 0, 255]);
      expect(result.padTop.slice(0, 3)).toEqual([255, 255, 255]);
      expect(result.padBottom.slice(0, 3)).toEqual([255, 255, 255]);
    });
  }

  test('下載產出的 PNG 讀回後尺寸與像素內容正確（驗證實際下載檔案，非僅記憶體中的 canvas）', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', makeInputFiles());
    await page.waitForSelector('.crop-selection');
    await waitAllCropsReady(page, 3);
    await page.selectOption('#outputMode', 'original');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#downloadBtn'),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('下載未產生本機檔案路徑（環境不支援，測試無法繼續）');
    const base64 = fs.readFileSync(downloadPath).toString('base64');

    // 用 data: URL 在頁面內讀回下載的 PNG：img-src 已允許 data:（符合本頁 CSP，
    // 不需要為了測試弱化 connect-src），且 data: 來源不會 taint canvas，可安心 getImageData。
    const readBack = await page.evaluate((b64) => {
      return new Promise<{ width: number; height: number; red: number[]; green: number[]; blue: number[] }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          function px(x: number, y: number) { return Array.from(ctx.getImageData(x, y, 1, 1).data); }
          resolve({
            width: img.naturalWidth,
            height: img.naturalHeight,
            red: px(150, 40),
            green: px(150, 100),
            blue: px(150, 150),
          });
        };
        img.onerror = () => reject(new Error('讀回下載的 PNG 失敗'));
        img.src = 'data:image/png;base64,' + b64;
      });
    }, base64);

    expect(readBack.width).toBe(MAX_WIDTH);
    expect(readBack.height).toBe(TOTAL_HEIGHT);
    expect(readBack.red.slice(0, 3)).toEqual([255, 0, 0]);
    expect(readBack.green.slice(0, 3)).toEqual([0, 255, 0]);
    expect(readBack.blue.slice(0, 3)).toEqual([0, 0, 255]);
  });
});
