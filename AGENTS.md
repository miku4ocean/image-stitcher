# image-stitcher — 薄索引
跨平台規則正本：`~/.agents/institution/`（先讀 core/PRINCIPLES.md，照其指示附版本標記）。

## 專案專屬
- Build/test 指令：無建置（單一 HTML）。測試：`npx playwright test`（真實 Chromium，測試在 `tests/stitch.spec.ts`；首次需 `npx playwright install chromium`）。本機直接用瀏覽器開 `index.html` 即可執行。
- 架構一句話：純前端零後端圖片拼接工具，上傳多張截圖→逐張框選裁切→調順序→垂直拼接成長圖，手機觸控第一優先；單檔、零相依、零建置。
- 本專案禁區：`index.html` 開頭 HANDOFF 註解列的 8 個已修 bug 絕對不可回歸（函式定義順序、手機拖拽、拼接順序序列化、自然排序、換序保留裁切、resize 重算、檔名 escapeHtml、拼接鎖 isProcessing）；維持單一 HTML／零相依／零建置；介面與註解用繁體中文（台灣用語）。
- 路線圖：階段 1 本地單檔（已完成）→ 階段 2 GitHub Pages → 階段 3 PWA → 階段 4 Tauri。階段 3/4 等使用者確認階段 2 上線後才做。
- 深度交接見 `HANDOFF.md` 與 `index.html` 開頭註解。
