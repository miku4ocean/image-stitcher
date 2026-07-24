# HANDOFF — image-stitcher
更新：2026-07-24／claude

## 目前目標
交接一個核心功能已完成的前端拼接工具，補齊兩項待實作資安措施（CSP、記憶體上限）並以 Playwright 驗證，準備階段 2（GitHub Pages）上線。

## 狀態
- 已完成：核心功能（上傳／裁切／換序／垂直拼接），交接文件列 8 個已修 bug（見 index.html 開頭註解，絕不可回歸）
- 進行中：補資安措施＋Playwright 驗證（本次交付包匯入時尚未做）
- 驗收現況：匯入時 Playwright 未實跑（tests/stitch.spec.ts 已有 2 條基礎測試，但 tests/fixtures/ 圖檔尚缺）（2026-07-24）

## 待實作資安（依 docs/mockup.html 資安總表）
1. **CSP**：`<head>` 加 Content-Security-Policy meta，限 script/style 來源（`'self' 'unsafe-inline'` 起步），禁外部連線 `connect-src 'none'`
2. **記憶體上限**：上傳檢查張數（>10 提示）與單張／總像素上限，超過以畫面內提示（非 alert）友善阻擋

## 8 個不可回歸的已修 bug（全文見 index.html 開頭）
1. selectFiles 函式定義順序 2. 手機拖拽紅框（touch 事件＋touch-action:none）3. 拼接順序序列化＋依索引寫入 4. 自然排序 localeCompare numeric 5. 換序/新增保留 cropData 6. resize debounce 重算座標 7. 檔名 escapeHtml 8. isProcessing 拼接鎖

## 下一步（接手的人從這裡開始）
1. 補 CSP 與記憶體上限兩項資安措施，補完 docs 資安總表對應項可視為「已具備」
2. 造 tests/fixtures 測試圖，跑 Playwright 七項驗證（自然排序／裁切拖曳縮放／換序重排保留／拼接順序／resize 座標／連點防重複／惡意檔名轉義）
3. 驗證通過後：階段 2 GitHub Pages 部署（使用者要完整指令清單）

## 地雷（別踩）
- 8 個已修 bug 絕不可回歸；維持單一 HTML／零相依／零建置
- 階段 3（PWA）、階段 4（Tauri）等使用者確認階段 2 上線後才做
- 介面與註解一律繁體中文（台灣用語）

## 主辦權
單線（claude 交接匯入）
