# 商品圖片批次轉檔工具

給電商店家用的批次圖片轉檔網頁：把整批照片一次轉成符合系統規格的商品圖。

**線上使用：** https://faust-777.github.io/product-image-resizer/

## 特色

- 🖼️ **批次處理**：拖入多張照片一次轉完，打包 ZIP 下載
- 📐 **等比縮放不變形**：兩種模式——「補底色成固定尺寸」（商品圖常用）或「等比縮至長邊」
- 📦 **自動壓到大小上限**：迭代調整品質，壓到 300KB / 500KB / 1MB / 2MB 以下
- 🔒 **零上傳**：全程在使用者瀏覽器內處理（Canvas API），照片不經過任何伺服器
- 💸 **零營運成本**：純靜態頁面託管在 GitHub Pages，用多少人都不會產生費用

## 使用方式

1. 選擇輸出規格（尺寸、縮放方式、大小上限、格式）
2. 把照片拖進虛線框（或點擊選檔）
3. 等處理完成，單張下載或「全部下載（ZIP）」

## 技術說明

- 純前端：HTML + CSS + Vanilla JS，無框架、無後端
- 縮圖品質：大幅縮小時分段減半（step-down）避免鋸齒；`imageSmoothingQuality: high`
- EXIF 方向：用 `createImageBitmap(..., { imageOrientation: "from-image" })` 自動轉正手機直拍照片
- 壓縮：`canvas.toBlob(type, quality)` 由 0.92 逐級降到 0.4，第一個低於上限的品質勝出
- 打包：JSZip（CDN 載入）
- 隱私：`noindex`（不進搜尋引擎）；檔案只存在記憶體，關頁即消失

## 開發

沒有建置流程，直接開 `index.html` 就能跑。部署 = push 到 main（GitHub Pages 自動發佈）。
