import { test, expect, Page } from '@playwright/test';
import path from 'path';
import { makeSolidPng, makeHorizontalSplitPng } from './fixtures/pngHelper';

const FIX = (name: string) => path.join('tests/fixtures', name);

// 觸控操作測試（手機第一優先場景）。
// index.html 的已修 bug #2：「手機無法拖拽紅框」，修法是 touchstart + 全域 touchmove/touchend
// + touch-action:none + {passive:false}。下面用真正的 TouchEvent（而非滑鼠事件）驅動同一套
// 拖拽邏輯，對應這條迴歸防線；並額外檢查 .crop-selection 的 computed style touch-action，
// 直接對照修法本身有沒有被移除。
//
// 以 dispatchEvent 送出的合成 TouchEvent 會正常冒泡到 document（bubbles:true），
// 與 index.html 內部「touchstart 綁在選取框/把手本身、touchmove/touchend 綁在 document」
// 的事件流程完全對得上，因此可以真實驅動 startDrag → handleDrag → endDrag 全流程。
async function touchDrag(
  page: Page,
  selector: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 6
) {
  await page.evaluate(
    ({ selector, from, to, steps }) => {
      const el = document.querySelector(selector) as HTMLElement;
      if (!el) throw new Error('touchDrag: element not found: ' + selector);
      function fire(type: string, x: number, y: number) {
        // @ts-ignore Touch/TouchEvent 建構子在 Chromium 測試環境可用
        const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
        const touches = type === 'touchend' ? [] : [touch];
        const ev = new TouchEvent(type, {
          touches, targetTouches: touches, changedTouches: [touch],
          bubbles: true, cancelable: true,
        });
        el.dispatchEvent(ev);
      }
      fire('touchstart', from.x, from.y);
      for (let i = 1; i <= steps; i++) {
        fire('touchmove', from.x + (to.x - from.x) * (i / steps), from.y + (to.y - from.y) * (i / steps));
      }
      fire('touchend', to.x, to.y);
    },
    { selector, from, to, steps }
  );
}

async function waitCropReady(page: Page, index: number) {
  await page.waitForFunction((i) => {
    // @ts-ignore
    const cd = window.cropData;
    return cd && cd[i] && cd[i].cropRect;
  }, index);
}

test.describe('觸控操作（手機第一優先）', () => {
  test('觸控拖曳裁切框本體可移動位置，且 touch-action:none 仍生效（已修 bug#2 迴歸檢查）', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png'), FIX('2.png')]);
    await page.waitForSelector('#selection-0');
    await waitCropReady(page, 0);
    await page.locator('#selection-0').scrollIntoViewIfNeeded();

    // 已修 bug#2 的關鍵樣式：touch-action:none，一旦被移除手機會變成整頁捲動而非拖拽紅框
    const touchAction = await page.locator('#selection-0').evaluate((el) => getComputedStyle(el).touchAction);
    expect(touchAction).toBe('none');

    // 預設是全選（貼齊四邊），要先用觸控縮小才有「移動」的空間，作法比照既有滑鼠版測試②
    const seHandle = page.locator('#selection-0 .crop-handle.se');
    const hBox = await seHandle.boundingBox();
    if (!hBox) throw new Error('no se handle box');
    await touchDrag(
      page, '#selection-0 .crop-handle.se',
      { x: hBox.x + hBox.width / 2, y: hBox.y + hBox.height / 2 },
      { x: hBox.x - 40, y: hBox.y - 30 }
    );
    const afterResize = await page.locator('#selection-0').evaluate((el) => ({ w: el.style.width, h: el.style.height }));

    // 觸控移動：拖曳選取框本體（非把手）
    const beforeMove = await page.locator('#selection-0').evaluate((el) => ({ x: el.style.left, y: el.style.top }));
    const box = await page.locator('#selection-0').boundingBox();
    if (!box) throw new Error('no selection box after resize');
    await touchDrag(
      page, '#selection-0',
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: box.x + box.width / 2 + 20, y: box.y + box.height / 2 + 15 }
    );
    const afterMove = await page.locator('#selection-0').evaluate((el) => ({ x: el.style.left, y: el.style.top }));

    expect(parseFloat(afterResize.w)).toBeGreaterThan(0);
    expect(afterMove.x).not.toBe(beforeMove.x);
    expect(afterMove.y).not.toBe(beforeMove.y);
  });

  test('觸控可各自觸發 8 個方向的縮放把手（nw/n/ne/w/e/sw/s/se）', async ({ page }) => {
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [FIX('1.png')]);
    await page.waitForSelector('#selection-0');
    await waitCropReady(page, 0);
    await page.locator('#selection-0').scrollIntoViewIfNeeded();

    // 裁切框預設是「全選」（x=0,y=0,寬高=顯示尺寸），此時已經頂到邊界，
    // 對照 index.html 的 handleDrag() switch-case：只有「往框內收」的方向會產生變化，
    // 「往框外拉」會被 Math.min(maxWidth-x, ...) / Math.min(maxHeight-y, ...) 卡住而毫無變化
    // （這不是 bug，是預期的邊界夾限行為）。因此每個把手要用「真的會讓它縮小」的方向拖曳，
    // 方向對照該 case 的算式手動推算，而非隨意套同一組 dx/dy。
    const directionDeltas: Record<string, { dx: number; dy: number }> = {
      nw: { dx: 15, dy: 15 },   // x=min(..,x+dx)、height=height-dy，皆需正值才會內收
      n: { dx: 0, dy: 15 },     // 只影響 y/height，需 dy>0
      ne: { dx: -15, dy: 15 },  // width=min(maxWidth-x, width+dx) 需 dx<0；height 需 dy>0
      w: { dx: 15, dy: 0 },     // 同 nw 的 x 邏輯，需 dx>0
      e: { dx: -15, dy: 0 },    // width=min(maxWidth-x, width+dx) 需 dx<0
      sw: { dx: 15, dy: -15 },  // x 需 dx>0；height=min(maxHeight-y, height+dy) 需 dy<0
      s: { dx: 0, dy: -15 },    // height=min(maxHeight-y, height+dy) 需 dy<0
      se: { dx: -15, dy: -15 }, // width/height 皆需負值
    };

    for (const dir of Object.keys(directionDeltas)) {
      // 每個方向測試前重設回全選，避免前一個方向的縮放結果影響下一個（也避免縮到 20px 下限卡死）
      // 注意：.crop-controls 是 .crop-item 內、與 image-preview 平行的兄弟節點，不在 #selection-0 底下
      await page.locator('.crop-controls .crop-btn').nth(1).click(); // 「重設」按鈕
      await page.waitForTimeout(50);

      const before = await page.locator('#selection-0').evaluate((el) => ({
        w: el.style.width, h: el.style.height, x: el.style.left, y: el.style.top,
      }));
      const handle = page.locator(`#selection-0 .crop-handle.${dir}`);
      const hBox = await handle.boundingBox();
      if (!hBox) throw new Error('no handle box for ' + dir);
      const startX = hBox.x + hBox.width / 2;
      const startY = hBox.y + hBox.height / 2;
      const { dx, dy } = directionDeltas[dir];
      await touchDrag(page, `#selection-0 .crop-handle.${dir}`, { x: startX, y: startY }, { x: startX + dx, y: startY + dy });

      const after = await page.locator('#selection-0').evaluate((el) => ({
        w: el.style.width, h: el.style.height, x: el.style.left, y: el.style.top,
      }));
      const changed = after.w !== before.w || after.h !== before.h || after.x !== before.x || after.y !== before.y;
      expect(changed, `方向 ${dir} 觸控拖曳後應改變 cropRect`).toBe(true);
    }
  });

  test('觸控裁切後，最終產出圖片尺寸與內容符合預期裁切範圍（上下二色帶圖，驗證只留下裁切到的色帶）', async ({ page }) => {
    // 上半 100px 紅、下半 100px 藍，寬 200px；純色圖沒辦法驗證「裁到哪一段」，
    // 需要真的有兩種顏色的圖片才能證明裁切範圍是對的，而不只是尺寸數字對。
    const splitPng = makeHorizontalSplitPng(200, 200, [255, 0, 0], [0, 0, 255], 100);
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [{ name: 'split.png', mimeType: 'image/png', buffer: splitPng }]);
    await page.waitForSelector('#selection-0');
    await waitCropReady(page, 0);
    await page.locator('#selection-0').scrollIntoViewIfNeeded();

    const imgBox = await page.locator('#img-0').boundingBox();
    if (!imgBox) throw new Error('no img box');
    // 用觸控拖曳「s」把手（下緣中央）往上收，收到顯示高度約 35% 處，
    // 確保停在紅色帶明顯範圍內（紅藍交界在 50%），裁切後應該只剩紅色、完全不含藍色
    const sHandle = page.locator('#selection-0 .crop-handle.s');
    const sBox = await sHandle.boundingBox();
    if (!sBox) throw new Error('no s handle box');
    const targetY = imgBox.y + imgBox.height * 0.35;
    await touchDrag(
      page, '#selection-0 .crop-handle.s',
      { x: sBox.x + sBox.width / 2, y: sBox.y + sBox.height / 2 },
      { x: sBox.x + sBox.width / 2, y: targetY }
    );

    await page.selectOption('#outputMode', 'original');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    const result = await page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      function px(x: number, y: number) { return Array.from(ctx.getImageData(x, y, 1, 1).data); }
      return {
        width: c.width,
        height: c.height,
        top: px(Math.floor(c.width / 2), 2),
        bottom: px(Math.floor(c.width / 2), c.height - 2),
      };
    });

    // 寬度沒有透過 w/e 把手動過，應仍等於原圖寬度 200（僅垂直方向被 s 把手裁切）
    expect(result.width).toBeGreaterThanOrEqual(198);
    expect(result.width).toBeLessThanOrEqual(200);
    // 高度應明顯小於原圖 200（確實被裁切了），且遠小於紅藍交界的 100，確保沒有裁到藍色
    expect(result.height).toBeLessThan(100);
    expect(result.height).toBeGreaterThan(20);
    // 裁切結果從頭到尾都應該是紅色，完全不含藍色（證明裁切範圍精確落在紅色帶內）
    expect(result.top.slice(0, 3)).toEqual([255, 0, 0]);
    expect(result.bottom.slice(0, 3)).toEqual([255, 0, 0]);
  });

  test('調整拼接順序後，最終拼接產出的色帶順序正確改變（本專案排序介面是「拼接順序」下拉選單，非拖曳縮圖元件——如實依現有 UI 測試）', async ({ page }) => {
    const redPng = makeSolidPng(120, 100, [255, 0, 0]);
    const bluePng = makeSolidPng(120, 100, [0, 0, 255]);
    await page.goto('file://' + path.resolve('index.html'));
    await page.setInputFiles('#fileInput', [
      { name: 'a-red.png', mimeType: 'image/png', buffer: redPng },
      { name: 'b-blue.png', mimeType: 'image/png', buffer: bluePng },
    ]);
    await page.waitForSelector('.crop-selection');
    await waitCropReady(page, 0);
    await waitCropReady(page, 1);

    // 把位置 1（紅）換到位置 2，使紅藍互換 → 預期拼接後上方變藍、下方變紅
    await page.locator('.crop-item').nth(0).locator('.position-control select').selectOption('1');
    await expect(page.locator('.crop-name')).toHaveCount(2);
    const namesAfter = await page.locator('.crop-name').allTextContents();
    expect(namesAfter.map((t) => t.replace(/^位置 \d+:\s*/, ''))).toEqual(['b-blue.png', 'a-red.png']);
    await waitCropReady(page, 0);
    await waitCropReady(page, 1);

    await page.selectOption('#outputMode', 'original');
    await page.click('#processBtn');
    await page.waitForSelector('#resultArea', { state: 'visible' });

    const { top, bottom } = await page.locator('#resultCanvas').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')!;
      const t = ctx.getImageData(Math.floor(c.width / 2), 5, 1, 1).data;
      const b = ctx.getImageData(Math.floor(c.width / 2), c.height - 5, 1, 1).data;
      return { top: Array.from(t), bottom: Array.from(b) };
    });
    // 換序後：藍在上、紅在下（原本是紅在上、藍在下）
    expect(top.slice(0, 3)).toEqual([0, 0, 255]);
    expect(bottom.slice(0, 3)).toEqual([255, 0, 0]);
  });
});
