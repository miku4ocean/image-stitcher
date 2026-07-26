# HANDOFF — image-stitcher
更新：2026-07-26／claude code

## 目前目標
階段 2（GitHub Pages）已上線。下一步：等使用者確認後再議階段 3（PWA）。

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
- 已完成：Playwright 七項驗證 + 2 條原始基礎測試，共 10 條，實跑 `npx playwright test --repeat-each=5`（50 次執行）全綠，無 flaky

## 資安補強內容（依 docs/mockup.html 資安總表，已從「待實作」改為「已具備」）
1. **CSP**（index.html `<head>`）：
   `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'`
   已實測：`file://` 開啟、上傳／裁切／拼接／`canvas.toDataURL()` 匯出全程無 CSP 違規（console 無 CSP 相關訊息）。
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
- 環境：`npm init -y` + `@playwright/test` + `npx playwright install chromium`；`playwright.config.ts`（testDir=tests, chromium）
- 測試圖：`tests/fixtures/generate.js`（零相依，純 Node zlib 手刻 PNG）產生 1.png ~ 11.png（可辨識漸層色，供拼接順序像素取樣驗證）；惡意檔名 `<script>alert(1)</script>.png` 因含 `/` 無法作為真實檔名，改用 `page.setInputFiles({name, buffer})` 動態指定檔名
- 10 條測試（①~⑦ + 2 條原始基礎測試 + 1 條張數上限資安測試），`--repeat-each=5` 共 50 次執行全綠

## 下一步（接手的人從這裡開始）
1. 階段 2 GitHub Pages 部署已完成（見上方部署紀錄），網址 https://miku4ocean.github.io/image-stitcher/
2. **等使用者確認後**才議階段 3（PWA）、階段 4（Tauri）

## 地雷（別踩）
- 8 個已修 bug 絕不可回歸；維持單一 HTML／零相依／零建置
- repo 現為 public，往後每次 commit 前留意勿引入密鑰／敏感資訊
- 階段 3（PWA）、階段 4（Tauri）等使用者確認階段 2 上線後才做
- 介面與註解一律繁體中文（台灣用語）
- `tests/fixtures/*.png` 是可重現產物（`node tests/fixtures/generate.js`），不必手動維護

## 主辦權
單線（claude code 接手，補資安＋測試）
