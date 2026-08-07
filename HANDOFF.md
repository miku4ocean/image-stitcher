# HANDOFF — image-stitcher
更新：2026-08-07／claude code

## 目前目標
階段 3（PWA）已完成，UX 打磨已完成。下一步：階段 4（Tauri）仍待使用者確認，不在本次範圍。

## 本輪交付（2026-08-07，8 項 UX/品質改善）
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
- 已完成：Playwright 十九項驗證（原 10 條 stitch + 4 條 PWA + 新增 5 條 UX），實跑全綠
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
- 19 條測試（stitch.spec.ts 15 條 + pwa.spec.ts 4 條），全綠

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
