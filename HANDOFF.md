# HANDOFF — image-stitcher
更新：2026-07-28／claude code

## 目前目標
階段 3（PWA）已完成。下一步：階段 4（Tauri）仍待使用者確認，不在本次範圍。

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
- **測試環境**：新增 `scripts/dev-server.js`（零相依純 Node 靜態伺服器，因 service worker
  需要 http(s) 才能註冊，file:// 不支援），`playwright.config.ts` 新增 `webServer` 設定
  （自動啟停，僅供 `tests/pwa.spec.ts` 使用；既有 `tests/stitch.spec.ts` 仍走
  `page.goto('file://...')`，完全不受影響）。

## 階段 3 驗收結果
- `npx playwright test`：14 條全綠（既有 10 條 stitch.spec.ts 零回歸 + 新增 4 條
  pwa.spec.ts：manifest 內容驗證、index.html 引用驗證、SW 註冊成功、離線 reload 仍可載入）。
  `--repeat-each=3`（42 次執行）同樣全綠，無 flaky。
- 手動起本機 server（`PORT=8799 node scripts/dev-server.js &`，記錄 PID 後用 `kill $PID`
  精準關閉，未用 pkill/killall）以 Playwright script 驗證 SW 快取行為，實際 console log：
  - 第一次載入：`[SW] install：precache 開始 → [...]`（precache 寫入）
  - 第二次導覽：`[SW] cache hit: http://localhost:8799/index.html`
  - 手動清掉單一快取項目後重新請求：`[SW] cache miss, fetching: http://localhost:8799/manifest.json`
  - 再次重新整理：`[SW] cache hit: http://localhost:8799/manifest.json`
- 備註：因採「install 時主動 precache」策略（非被動 lazy cache-on-first-fetch），
  瀏覽器對「頁面自身的第一次導覽請求」本來就不會被尚在安裝中的 SW 攔截
  （這是標準 SW 行為，非 bug）；故用「清掉單一快取項目→重新請求→再次命中」的方式，
  額外驗證 miss→fetch→補寫入→hit 的完整循環確實運作正常。

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
- 已完成：Playwright 十四項驗證（原 10 條 + PWA 4 條），實跑全綠、`--repeat-each` 多次無 flaky
- 已完成：PWA（manifest／icons／service worker／離線可用）

## 資安補強內容（依 docs/mockup.html 資安總表，已從「待實作」改為「已具備」）
1. **CSP**（index.html `<head>`）：
   `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'`
   已實測：`file://` 開啟、上傳／裁切／拼接／`canvas.toDataURL()` 匯出全程無 CSP 違規（console 無 CSP 相關訊息）。
   注意：`connect-src 'none'` 也會擋掉頁面內任何 `fetch()`/XHR（包含測試用途），
   pwa.spec.ts 驗證 manifest.json 內容時改用 Playwright 的 `request` context（不經過頁面 CSP）。
2. **記憶體上限**（index.html `<script>` 內新增常數與函式）：
   - `MAX_FILES = 10`（張數上限，超過提示「建議一次不超過 10 張」）
   - `MAX_SINGLE_PIXELS = 4000 × 4000`（單張像素上限）
   - `MAX_TOTAL_PIXELS = 80,000,000`（總像素上限，約 10 張 8MP 圖片的總合）
   - 用 `createImageBitmap` 取得尺寸做檢查，超過任一項則用 `#limitToast`（黃色、非 alert）友善阻擋，不進入裁切流程；訊息 5 秒後自動消失。

## 這次順手修的一個既有小 bug（非「8 個不可回歸」名單內，但屬同類問題）
`setupCropInterface`／`createCropItem` 原本用「FileReader 完成順序」決定裁切卡片的 DOM 插入順序（並行、無鎖），
在檔案數較多時卡片視覺順序可能與實際陣列順序不一致（雖然 `selectedFiles`/最終拼接順序仍正確，只是畫面卡片可能跳位，
容易誤導使用者）。已改為「先依索引建立佔位節點、FileReader 完成後用 `replaceWith` 原地替換」，確保畫面卡片順序
永遠＝陣列順序，不受非同步完成快慢影響。不影響 8 個已修 bug 的既有邏輯。

## 8 個不可回歸的已修 bug（全文見 index.html 開頭，逐項已用 Playwright 驗證未回歸）
1. selectFiles 函式定義順序 2. 手機拖拽紅框（touch 事件＋touch-action:none）3. 拼接順序序列化＋依索引寫入 4. 自然排序 localeCompare numeric 5. 換序/新增保留 cropData 6. resize debounce 重算座標 7. 檔名 escapeHtml 8. isProcessing 拼接鎖

## Playwright 驗收（npm test / npx playwright test）
- 環境：`npm init -y` + `@playwright/test` + `npx playwright install chromium`；`playwright.config.ts`（testDir=tests, chromium, 新增 webServer 供 pwa.spec.ts 使用）
- 測試圖：`tests/fixtures/generate.js`（零相依，純 Node zlib 手刻 PNG）產生 1.png ~ 11.png（可辨識漸層色，供拼接順序像素取樣驗證）；惡意檔名 `<script>alert(1)</script>.png` 因含 `/` 無法作為真實檔名，改用 `page.setInputFiles({name, buffer})` 動態指定檔名
- 14 條測試（stitch.spec.ts 原 10 條 + pwa.spec.ts 新 4 條），`npx playwright test` 全綠；`--repeat-each=3`（42 次執行）全綠，無 flaky

## 下一步（接手的人從這裡開始）
1. 階段 2 GitHub Pages 部署已完成，網址 https://miku4ocean.github.io/image-stitcher/
2. 階段 3 PWA 已完成（本機驗證見上）；若要在 GitHub Pages 上實測「離線安裝」，
   push 後直接用手機瀏覽器開網址、加入主畫面測試即可（HTTPS 環境，SW 可正常運作）
3. **等使用者確認後**才議階段 4（Tauri）

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
單線（claude code 接手，補資安＋測試＋PWA）
