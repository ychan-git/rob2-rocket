# 部署 / 本機測試 — 純前端網頁版（web/）

這是純靜態網站,沒有後端。使用者自帶 Anthropic API key,瀏覽器直接打 Anthropic。

## 本機測試

模組 import 和 `fetch()` 需要 http://(不能用 file:// 直接開),所以要起一個靜態伺服器:

```bash
cd web
python3 -m http.server 7700
# 開 http://localhost:7700/
```

(任何靜態伺服器都行:`npx serve`、`php -S` 等。)

## 部署 Cloudflare Pages

純靜態,**不需要 build**:

1. 把 repo push 上 GitHub。
2. Cloudflare Pages → Create project → 接該 repo。
3. 設定:
   - **Framework preset**: None
   - **Build command**: (留空)
   - **Build output directory**: `web`
4. Deploy 完成,網址就能用。

> 也可以直接把 `web/` 整個資料夾拖進 Cloudflare Pages 的 Direct Upload,不接 git。

## 外部相依（純靜態但會連這兩個網域）

- `esm.sh` — 載入 Anthropic JS SDK(已在 `engine.js` 釘版本 `@anthropic-ai/sdk@0.104.1`)。
  要完全離線/自管可改成把 SDK bundle 放進 repo 再 import 本地檔。
- `api.anthropic.com` — 使用者的 API 呼叫。瀏覽器直連靠 SDK 的 `dangerouslyAllowBrowser:true`
  (自動帶 `anthropic-dangerous-direct-browser-access` header 過 CORS)。
- `cdn.jsdelivr.net`(或 mermaid 的 CDN)— 流程圖;已用 `MERMAID_OK` try/catch 包住,掛了也不會拖垮頁面。

## 安全

- API key 只存使用者自己的 `localStorage`(`rob2_api_key`),只送 Anthropic,不 log、不送第三方。
- 沒有共用機密、沒有伺服器,所以沒有「洩漏你的 key」的問題——每個使用者用自己的 key。
