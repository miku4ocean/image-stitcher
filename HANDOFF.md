# HANDOFF — image-stitcher
更新：2026-09-04／claude code

## 目前目標
階段 3（PWA）已完成，UX 打磨已完成。下一步：階段 4（Tauri）仍待使用者確認，不在本次範圍。

## 本輪交付（2026-09-04，首輪深度偵錯：6 個真 bug，測試 33 → 44 條）
前幾輪都是「補測試沒發現真 bug」，本輪改用擬真流程逐項驗真實產出（Canvas getImageData 取像素、
實際下載檔案、真滑鼠／觸控事件、量測版面矩形），挖出 6 個「測試全綠但產品其實壞掉」的 bug。
全部先寫會紅的測試證明症狀，再修到綠（新測試集中在 `tests/deep-debug.spec.ts`）。

1. **輸出畫布超過瀏覽器上限 → 靜默產出全空白圖**（最嚴重）。4 張 300x2200 的窄長截圖
   （完全在工具自訂的張數／單張／總像素上限內）配預設的「固定寬度 3000px」→ 畫布 3000x88000。
   Chromium 單邊上限實測 65535（65536 就爆），超過時 canvas 尺寸讀起來正常、繪圖不拋錯，
   但像素全透明、`toBlob` 回 null → 結果區一片空白、按下載毫無反應、零錯誤訊息。
   修法：`MAX_CANVAS_SIDE`/`MAX_CANVAS_AREA` 夾限 scaleFactor 等比例縮小 + toast 告知縮放比例；
   `downloadResult` 的 `if (!blob) return` 也補上失敗提示（原本是靜默吞掉）。
2. **裁切框可被拖出圖片邊界**：`handleDrag` 的 n/nw/ne/w/sw 只夾限 x/y，寬高卻用
   `width - dx` 無上限增加。預設全選狀態下把上緣把手往上拖 100px（很自然的動作），
   裁切框高度就超出圖片下緣 → 產出多一條幽靈白帶，資訊列還顯示比原圖大的尺寸（200x250 vs 200x200）。
   修法：改成「固定邊反推寬高」（拖左緣時右緣不動）。
3. **`totalPixelSum` 只加不減**：`handleFiles` 是整批取代但總像素沒歸零，重選幾輪後
   即使畫面上只有幾張小圖也會被自己的舊帳以「圖片總像素過大」擋掉。修法：`checkAndAddFiles`
   加 `replaceAll` 參數，整批取代時從 0 重算。
4. **壞圖被靜默略過**：損毀圖片的卡片永遠停在「等待圖片載入...」（沒有 `img.onerror`），
   拼接時被跳過只有 console.warn，畫面上完全沒提示 → 使用者拿到「少一張但看起來正常」的成品。
   修法：`markCropItemFailed()` 標示該張卡片（用 textContent，天然免疫 XSS）＋拼接後 toast 略過張數。
5. **預覽圖被拉伸變形**：`.preview-img` 同時有 `width:100%` 與 `max-height:400px`，
   width 是確定值時 max-height 只砍高度不等比縮寬度 → 1170x2532 的手機截圖（本工具最主要情境）
   在桌面被畫成 1132x400，長寬比 0.46→2.83（橫向拉伸約 6 倍），使用者是看著變形的圖在拉裁切框。
   修法：圖片只留 `max-width/max-height`，容器改 `width:fit-content; max-width:100%`（裁切框與圖片
   仍精準對齊，已用矩形量測驗證）。**連帶調整**：`stitch.spec.ts` ⑤ 的輸入圖改成 1200x400
   （200x150 的 fixture 修好後不再被放大到容器寬，縮視窗不會變小，測不到 resize 重算路徑），
   斷言一字未改。
6. **提示訊息裡的檔名雙重跳脫**：`showToast` 用 textContent，呼叫端卻又 escapeHtml 一次，
   檔名含 `&<>` 會顯示成 `a&amp;b&lt;c&gt;.png`。修法：移除多餘的 escapeHtml（卡片上的仍保留）。

**反證（不是 bug，已寫測試鎖住）**：
- **EXIF 方向其實是對的**：舊文件寫「無 EXIF 方向處理（iPhone 直拍可能旋轉）」不成立。
  手工組一張 Orientation=6 的 JPEG 實測，`naturalWidth/Height` 與 `drawImage` 取樣都已轉正
  （現代瀏覽器 `image-orientation:from-image` 是預設值），預覽／裁切換算／輸出三者一致。
  測試已鎖住此行為，**日後不要照舊文件再補一次手動旋轉，會變成轉兩次**。
- **拖放高亮不會閃爍**：`dragleave` 進到子元素時雖會移除 `.drag-over`，但子元素的 `dragover`
  會在同一個 task 內冒泡回上傳區重新加上，畫面上不會閃，屬非問題。
- **SW cache-first 不會自動更新 index.html** 是文件明載的刻意設計（版號手動 +1），
  非 bug；但屬部署流程風險——改 index.html 後若忘了把 `CACHE_NAME` 版號 +1，
  回訪使用者會一直停在舊版。建議日後在部署 checklist 明列這一步。

測試：33 → 44 條（新增 11：deep-debug.spec.ts），`--repeat-each=2` 88 次執行全綠、無 flaky。

## 本輪交付（2026-08-17，QA 深化：補齊拼接品質／觸控／PWA離線／手機版面四大類測試）
既有 19 條測試只涵蓋互動流程與 8 個已修 bug 的迴歸，**完全沒有像素級驗證拼接輸出、
沒有真正的觸控事件測試、PWA 離線只測了「頁面能載入」、也沒有 375px 手機版面驗證**。
本輪針對這四個缺口補測試，新增 4 個測試檔：

1. **`tests/fixtures/pngHelper.ts`**（新增）：沿用 `generate.js` 的零相依手刻 PNG 手法
   （純 Node `zlib`），參數化成 `makeSolidPng(w,h,rgb)` 與
   `makeHorizontalSplitPng(w,h,topRgb,bottomRgb,splitY)`，供測試動態產生「刻意不同尺寸／
   刻意雙色」的合成圖片，不需要額外的固定 fixture 檔案，也沒有引入任何新 npm 相依套件。
2. **`tests/quality.spec.ts`**（新增，5 條）：拼接產出品質像素級驗證。
   讀 `index.html` 的 `stitchCroppedImages()` 確認演算法規則：**輸出寬度＝三張裁切後
   畫布中最寬的那張**（不是固定值、也不是取第一張），高度＝裁切後總和，每張圖以
   `(finalWidth-scaledWidth)/2` 置中、兩側留白。用三張刻意不同寬度（100/300/150px）的
   合成圖驗證此規則（避免同寬 tautology）：
   - 4 條分別驗證 outputMode 的 4 種選項（原始/2x/3x/固定寬3000px）：斷言最終畫布寬高
     公式正確、三個色段像素顏色正確對應來源圖、置中留白處確實是白色。
   - 1 條驗證**實際下載的 PNG 檔案**（非僅記憶體中的 canvas）：攔截 download 事件、
     讀本機下載檔案位元組轉 base64、用 `data:` URL 在頁面內讀回（`img-src` 本來就允許
     `data:`，不需弱化 CSP；`data:` 來源不會 taint canvas）驗證尺寸與像素正確。
3. **`tests/touch.spec.ts`**（新增，4 條）：真正的 `TouchEvent`（非滑鼠事件模擬）驅動裁切
   互動，對應已修 bug#2「手機拖拽紅框」：
   - 觸控拖曳裁切框本體＋驗證 `touch-action:none` computed style 仍在（bug#2 迴歸線）
   - 觸控依序觸發全部 8 個方向縮放把手（含推導每個把手在「全選邊界」下該往哪個方向拖才會
     真的縮小，而非隨意套同一組座標差）
   - 用上下雙色合成圖驗證觸控裁切後最終產出**只含裁到的那個色段**，不只是尺寸數字對
   - 調整拼接順序後驗證最終拼接產出色帶順序真的跟著換（既有測試③只驗證 cropData 有保留，
     沒驗證到最終視覺結果；本專案排序介面實際上是「拼接順序」下拉選單，程式碼裡沒有縮圖
     拖曳排序元件，如實依現有 UI 測試，未杜撰不存在的功能）
4. **`tests/pwa.spec.ts`**（擴充，+2 條）：離線模式下上傳＋拼接全流程可用（純前端邏輯不需
   網路）；`CACHE_NAME` 離線前後一致且測試流程本身不變動 `sw.js`／`manifest.json`
   （讀檔內容前後 diff 比對佐證）。
5. **`tests/mobile.spec.ts`**（新增，3 條）：375px 視窗（iPhone SE 級別）—上傳區域可見、
   拼接按鈕可互動、預覽區不溢出視窗（無橫向捲動）；檔名含中文＋空白＋特殊字元不破版；
   `escapeHtml` XSS 迴歸補一個 `<img onerror=...>` 變種（既有測試⑦只測了 `<script>`）。

**沒發現真 bug**：全部是測試補強。過程中兩次「失敗」都是測試本身寫錯（選錯 CSS 選擇器、
誤判 8 向縮放把手在「全選邊界」下該往哪個方向拖曳才會產生變化），修正測試後即通過，
不是 `index.html` 的行為有問題——這反而佐證了邊界夾限（`Math.min(maxWidth-x, ...)`）
是刻意且正確的設計。

## 測試結果（本輪）
- 基線：`npx playwright test` 19 passed
- 交付後：`npx playwright test` **33 passed**（19 + 新增 14：品質5＋觸控4＋PWA+2＋手機3）
- `--repeat-each=3`：99 次執行全綠，無 flaky

## 上一輪交付（2026-08-07，8 項 UX/品質改善）
1. **Meta description + OG tags**：加入 `<meta name="description">` 與 Open Graph 標籤，
   提升 GitHub Pages 搜尋與分享預覽效果。
2. **桌面拖放上傳**：上傳區域支援 HTML5 drag-and-drop，拖入時邊框變綠色提示，
   放開即走既有 handleFiles/addFilesToExisting 流程。
3. **裁切框外暗化**：使用 `box-shadow: 0 0 0 9999px rgba(0,0,0,0.45)` 讓裁切框外蓋上
   半透明遮罩，保留範圍一目瞭然（mockup 建議的「可加強」項）。
4. **拼接進度條**：拼接過程中顯示「處理第 N / 總數 張」文字與漸層進度條，
   完成後自動隱藏（mockup 設計稿的進度可視化建議）。
5. **下載 PNG 按鈕**：使用 `canvas.toBlob` + `createObjectURL`（比 toDataURL 省記憶體），
   下載後 `revokeObjectURL` 釋放。檔名含時間戳 `stitched_YYYYMMDD_HHmm.png`。
6. **Web Share API**：手機支援 `navigator.share` 時顯示「分享」按鈕，可直接分享 PNG
   到 LINE、iMessage 等 App。桌面不支援時按鈕自動隱藏。
7. **無障礙改善**：上傳區域加入 `role=button` + `tabindex=0` + 鍵盤 Enter/Space 觸發，
   `focus-visible` 外框樣式，toast 改 `role=alert` + `aria-live=assertive`，
   進度文字加 `aria-live=polite`。
8. **降級處理（bug fix）**：`cropAndLoadImage` 補齊 `reader.onerror` 與 `img.onerror`，
   單張失敗回傳 null 讓 `stitchCroppedImages` 跳過，全部失敗時顯示 toast。
   修復原本單張解碼失敗會導致整個拼接流程永久卡死的 bug。

## 測試結果
- `npx playwright test`：19 條全綠（原 14 條零回歸 + 新增 5 條）
- `--repeat-each=2`：38 次執行全綠，無 flaky

## 階段 3 部署紀錄（2026-07-28）
- **manifest.json**：name/short_name「圖片拼接工具」、display: standalone、
  background_color/theme_color 沿用主畫面色 `#00CED1`、icons 192x192＋512x512。
- **圖示**：`icons/generate-icons.js`（零相依，純 Node zlib 手刻 PNG，手法沿用
  `tests/fixtures/generate.js` 先例）程式繪製產生，簡潔風格（teal 底＋白色兩條圓角橫條，
  象徵「兩張截圖上下拼接」）。輸出 `icons/icon-192.png`、`icons/icon-512.png`、
  `icons/apple-touch-icon.png`（180x180），皆已進 repo，無任何外部素材。
- **sw.js**：cache-first 策略，`CACHE_NAME = 'image-stitcher-toolbox-v1'`，
  activate 事件清舊版號快取；install 時 precache index.html/manifest.json/圖示。
  console 訊息前綴 `[SW]`，區分 `cache hit` / `cache miss, fetching`。
- **index.html 最小改動**：只加 `<link rel="manifest">`、
  `<meta name="theme-color" content="#00CED1">`、apple-touch-icon link，
  以及一段獨立的 SW 註冊 `<script>`（不動原本的 script 區塊，8 個已修 bug 邏輯零異動）。

## 階段 2 部署紀錄（2026-07-26）
- 密鑰掃描：全歷史（`git rev-list --all` 逐 commit `git grep`）＋工作區（含未追蹤檔案）掃描
  api key／secret／token／password／AKIA／sk-／ghp_／Bearer／私鑰 PEM 等 pattern，**全部零命中**。
- repo 可見性：public（`gh repo view` 已驗證 `visibility: PUBLIC`）。
- GitHub Pages：`main` 分支根目錄 `/`，已建站並驗證。
  網址：https://miku4ocean.github.io/image-stitcher/
  驗證：`curl -sI` 回 `HTTP/2 200`，頁面 `<title>圖片拼接工具 - 手動裁切版</title>`，
  `content-length: 35282` 與 `index.html` 檔案大小一致。

## 狀態
- 已完成：核心功能（上傳／裁切／換序／垂直拼接），8 個已修 bug 全數保留未回歸（見 index.html 開頭註解）
- 已完成：兩項資安補強 —— CSP meta、張數／像素上限（畫面內 toast 阻擋，非 alert）
- 已完成：Playwright 三十三項驗證（stitch 15 + pwa 6 + quality 5 + touch 4 + mobile 3），實跑全綠
- 已完成：PWA（manifest／icons／service worker／離線可用）
- 已完成：UX 打磨（拖放上傳、裁切暗化、進度條、下載、分享、鍵盤無障礙、降級處理）

## 資安補強內容（依 docs/mockup.html 資安總表，全部「已具備」）
1. **CSP**（index.html `<head>`）：
   `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'`
2. **記憶體上限**：MAX_FILES=10、MAX_SINGLE_PIXELS=16MP、MAX_TOTAL_PIXELS=80MP
3. **降級處理**：reader.onerror + img.onerror 回呼，失敗不卡死

## 8 個不可回歸的已修 bug（全文見 index.html 開頭，逐項已用 Playwright 驗證未回歸）
1. selectFiles 函式定義順序 2. 手機拖拽紅框（touch 事件＋touch-action:none）3. 拼接順序序列化＋依索引寫入 4. 自然排序 localeCompare numeric 5. 換序/新增保留 cropData 6. resize debounce 重算座標 7. 檔名 escapeHtml 8. isProcessing 拼接鎖

## Playwright 驗收（npm test / npx playwright test）
- 環境：`@playwright/test` + chromium；`playwright.config.ts`（testDir=tests, chromium, webServer 供 pwa.spec.ts）
- 33 條測試，全綠：
  - `stitch.spec.ts` 15 條（互動流程 + 8 個已修 bug 迴歸）
  - `pwa.spec.ts` 6 條（manifest／SW 註冊／離線載入／離線上傳拼接／CACHE_NAME 版本一致）
  - `quality.spec.ts` 5 條（拼接輸出像素級驗證，含 4 種 outputMode ＋ 下載檔案讀回驗證）
  - `touch.spec.ts` 4 條（真實 TouchEvent 驅動裁切拖曳／8 向縮放／裁切範圍／換序後輸出）
  - `mobile.spec.ts` 3 條（375px 版面／特殊檔名／escapeHtml XSS 迴歸補充）

## 下一步（接手的人從這裡開始）
1. 階段 2 GitHub Pages 部署已完成，網址 https://miku4ocean.github.io/image-stitcher/
2. 階段 3 PWA 已完成（本機驗證見上）；push 後用手機瀏覽器開網址、加入主畫面測試即可
3. **等使用者確認後**才議階段 4（Tauri）
4. 已知限制：無 EXIF 方向處理（iPhone 直拍可能旋轉），可用 `createImageBitmap`
   的 `imageOrientation:'from-image'` 改寫 `cropAndLoadImage`，但需改核心路徑

## 地雷（別踩）
- 8 個已修 bug 絕不可回歸；維持單一 HTML／零相依／零建置
- repo 現為 public，往後每次 commit 前留意勿引入密鑰／敏感資訊
- 階段 4（Tauri）等使用者確認階段 3 之後才做
- 介面與註解一律繁體中文（台灣用語）
- `tests/fixtures/*.png` 是可重現產物（`node tests/fixtures/generate.js`），不必手動維護
- `icons/*.png` 同樣是可重現產物（`node icons/generate-icons.js`），改圖示設計就重跑腳本
- CSP 的 `connect-src 'none'` 是刻意的安全設計，未來若要加任何 fetch/XHR 需求要三思，
  且測試驗證時要用 Playwright 的 `request` context 繞過頁面 CSP，而不是弱化 CSP 本身

## 主辦權
單線（claude code 接手，補資安＋測試＋PWA＋UX 打磨）
