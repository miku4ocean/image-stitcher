# image-stitcher — 專案進度報告

## A. 專案名稱
image-stitcher（圖片拼接工具 — 手動裁切版）

## B. 專案路徑
`/Users/leonalin/Code/image-stitcher`

## C. 專案簡介
純前端、零後端的截圖拼接工具。使用者上傳多張截圖後，逐張以紅色裁切框框選要保留的區域，調整順序，最終垂直拼接成一張長圖。手機觸控為第一優先設計目標，整個工具就是單一 `index.html` 檔案，無伺服器、無資料庫、無建置流程。

## D. 專案開發目的
（依 `HANDOFF.md`／`index.html` 開頭 HANDOFF 註解實讀）提供一個「不需要安裝任何工具、不需要上傳圖片到任何伺服器」的極簡截圖拼接方案，讓使用者能快速把多張分段截圖（例如長對話紀錄、多頁文件截圖）合併成一張長圖，並保留「本機處理」作為核心信任基礎。

## E. 解決使用者痛點
- 常見情境：對話紀錄、網頁內容、文件需要分段截圖才能截全，事後要手動拼接成一張長圖。
- 多數線上拼圖工具需要上傳圖片到第三方伺服器，有隱私疑慮；image-stitcher 從架構上排除此風險（無上傳）。
- 一般拼圖流程無法針對「每張截圖只保留部分區域」做精細控制（例如去掉重複的標題列、狀態列）；本工具讓使用者對每張圖各自裁切後再拼接。
- 手機上操作裁切框常見「touch 事件抓不到」的體驗問題；本工具將手機觸控列為第一優先並實測修正。

## F. 專案功能細項介紹
- 多檔選取上傳（`accept="image/*"`），依檔名自然排序（`1, 2, …, 10` 正確排序，非字典序）
- 每張圖片獨立裁切框：拖拽移動、8 向控制點縮放（NW/N/NE/W/E/SW/S/SE），滑鼠與觸控雙軌事件
- 「全選」／「重設」快捷鈕，一鍵還原裁切框為整張圖
- 拼接順序下拉選單：可任意調整每張圖在最終拼接結果中的位置，換序後既有裁切設定依比例保留
- 「新增更多圖片」：可在裁切階段追加圖片，不影響既有裁切設定
- 視窗尺寸改變（含手機轉向）時，200ms debounce 後重新依比例計算所有裁切框座標
- 輸出設定：原始大小／2 倍品質／3 倍品質／固定寬度 3000px 四種模式
- 序列化拼接處理（依索引逐張處理，避免非同步完成順序不一致），拼接期間按鈕鎖定防連點
- 拼接完成後自動捲動至結果區；可「繼續合併」清空狀態回到上傳畫面
- 資安防護：CSP meta（`connect-src 'none'` 等）、檔名 XSS 轉義（`escapeHtml`）、張數／單張像素／總像素三項上限＋畫面內 toast 友善阻擋（非 `alert`）

## G. 專案規格及 RPD

**技術棧**
- Vanilla JavaScript（ES5 語法為主）＋ HTML5 Canvas API，無任何前端框架
- 零建置、零相依套件（`index.html` 單檔即完整應用）
- 測試：`@playwright/test`（真實 Chromium）；`typescript` 僅作為 devDependency（測試檔用 `.ts`）
- 測試圖產生：`tests/fixtures/generate.js`（零相依、純 Node `zlib` 手刻 PNG）

**埠 / 執行方式**
- 無伺服器、無埠號。直接以瀏覽器開啟 `index.html`（`file://` 協定）即可執行，或部署到任何靜態託管（尚未部署，見 H/I）

**指令**
- 測試：`npx playwright test`（首次需 `npx playwright install chromium`）；`npm test` 為同一指令的別名（`package.json` scripts.test = `playwright test`）
- 重跑穩定性驗證：`npx playwright test --repeat-each=5`
- 無 build/dev/lint 指令（`package.json` 未定義，且專案本就無建置流程）

**資料流**
圖片檔案 → `FileReader.readAsDataURL` 讀成 dataURL → 使用者手動框選裁切區域（座標存於 `cropData[]`，以顯示尺寸為基準，處理時依 `originalWidth/displayWidth` 比例換算回原始像素）→ `processImages()` 依索引序列化呼叫 `cropAndLoadImage()`，用 `Canvas 2D` 依裁切座標重繪成獨立 canvas → `stitchCroppedImages()` 依 `outputMode` 計算縮放係數，將所有裁切後 canvas 由上到下疊繪到 `#resultCanvas` → 結果只存在於分頁記憶體與畫面上的 canvas，不寫入 `localStorage`，重新整理即清空。

**Git / 部署狀態**
- 獨立 git repo，已設定 remote：`https://github.com/miku4ocean/image-stitcher.git`
- 目前分支歷史（`git log --oneline`）：`chore: import handoff package + project skeleton` → `security: 補齊 CSP 與記憶體上限兩項資安措施` → `test: 建 Playwright 環境並實跑七項驗證，全綠`
- 尚未部署到 GitHub Pages（階段 2，等待使用者確認後才進行，見 `AGENTS.md`／`HANDOFF.md`）

## H. 目前已完成項目
- 核心功能：上傳／逐張手動裁切（8 向縮放＋拖曳）／換順序／垂直拼接，四種輸出尺寸模式
- 8 個歷史 bug 已修正且列入「禁止回歸」清單（見 `index.html` 開頭 HANDOFF 註解、`AGENTS.md`）：
  1. `selectFiles` 函式定義順序
  2. 手機拖拽紅框（`touchstart` + 全域 `touchmove`/`touchend`、`touch-action:none`、`{passive:false}`）
  3. 拼接順序序列化＋依索引寫入（禁止並行 `push`）
  4. 自然排序（`localeCompare(numeric:true)`）
  5. 換順序／新增圖片後保留既有裁切設定
  6. 視窗 resize 後裁切座標依比例重算（200ms debounce）
  7. 檔名含 HTML 特殊字元的 XSS 防護（`escapeHtml`）
  8. 拼接按鈕連點防呆（`isProcessing` 鎖）
- 兩項資安補強（`HANDOFF.md` 記載已從「待實作」轉為「已具備」）：CSP meta、張數／單張像素／總像素三項上限（畫面內 toast，非 `alert`）
- 一項順手修復（非清單內但同類問題）：`setupCropInterface`／`createCropItem` 改為「先建佔位節點、`FileReader` 完成後 `replaceWith` 原地替換」，確保畫面卡片順序恆等於陣列順序，不受非同步完成快慢影響
- Playwright 測試：10 條測試（自然排序、裁切拖拽縮放、換序保留裁切、拼接順序正確性、resize 重算、連點防呆、惡意檔名 XSS、張數上限、2 條原始基礎測試），以 `--repeat-each=5` 共 50 次執行全綠、無 flaky（`HANDOFF.md` 記載）
- 設計文件：`docs/mockup.html`（各畫面 mockup＋UI/UX／資安標註）、`docs/mockup_spec.html`（規格版）
- 本次交付：`docs/architecture.html`／`docs/architecture.svg`／`docs/architecture.mmd`（Galley 視覺語言系統架構圖）、`mockup/`（4 個前台畫面狀態＋1 個 toast overlay 狀態的 Galley 風格線框稿＋總覽頁）

## I. 尚待完成項目
- **階段 2：GitHub Pages 部署**——repo 已建立且已設定 remote，但尚未實際部署上線；`AGENTS.md`／`HANDOFF.md` 明確記載「等使用者確認後才動作」，非技術阻礙，是決策等待
- **階段 3：PWA**——追加 `manifest.json`、`sw.js`、`beforeinstallprompt` 安裝提示、離線快取；規劃中，尚未開始，需等階段 2 上線後才啟動（使用者偏好順序）
- **階段 4：Tauri 桌面打包**——使用者已表態偏好 Tauri 而非 Electron；規劃中，尚未開始，同樣需等階段 2、3 完成
- **EXIF 方向處理**——`index.html` 開頭註解列為已知限制：iPhone 直拍照片可能因 EXIF 方向資訊未處理而顯示旋轉；建議用 `createImageBitmap` 的 `imageOrientation:'from-image'` 選項改寫 `cropAndLoadImage`
- **下載功能**——「下載 PNG」已依使用者需求主動移除，僅保留「繼續合併」；若日後恢復下載需求，`HANDOFF.md` 建議改用 `canvas.toBlob()` 而非 `canvas.toDataURL()` 以節省記憶體
- 以上除「GitHub Pages 部署」屬於已就緒、等待確認外，其餘均為規劃中、尚未動工項目

## J. 系統優化或增加功能建議
以下為本次交付彙整時觀察到的建議方向，供後續評估，**非既有文件中的既定計畫**（已與 H/I 的既有規劃項目區分）：
- 大圖拼接（多張 4K 圖＋3000px 輸出）目前在主執行緒運算，未來可評估 `Web Worker` + `OffscreenCanvas`，避免拼接期間 UI 卡頓凍結（`docs/mockup.html` 資安總表已提出此建議，尚未實作）
- 目前「處理中」狀態只有按鈕文字變化（`拼接中…`），大量圖片時可考慮加入更明確的進度提示（例如「處理第 N／總數 張」），提升等待期間的安心感
- 裁切拖曳時可考慮將「被裁掉的區域」加暗，讓保留範圍更直覺（`docs/mockup.html` 已提出此 UI 建議）
- 若未來部署到 GitHub Pages，可評估在裁切框拖曳結束後加入輕量觸覺回饋（`navigator.vibrate`，僅行動裝置且需使用者授權情境下）
- 目前無任何自動化 lint／格式檢查（專案定位為單檔零建置，此為刻意選擇而非疏漏，此處僅供未來若擴大規模時參考）
