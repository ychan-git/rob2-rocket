# registry-worker — 試驗註冊庫查詢代理（Phase 1：ClinicalTrials.gov）

給 RoB2 Rocket 用的薄代理：把一個**公開的 NCT 號**換成**正規化後的試驗註冊資料**，補上 Domain 5（選擇性報告）唯一缺的那塊拼圖——「事前登記了什麼」。

## 為什麼需要它

- ClinicalTrials.gov 的 API v2 **不送 CORS header**，純前端的 rob2-rocket 在瀏覽器裡 fetch 會被擋。Worker 在伺服器端抓、加上 CORS，前端才打得到。
- 各註冊庫格式不一，Worker **正規化成單一 schema**（Phase 2 接 ITMCTR/ChiCTR/日韓庫時，回的形狀不變）。
- **隱私**：Worker 只收到一個公開的 NCT 號，**不經手 PDF、不經手任何病人資料**。

> 這是 Cloudflare **Worker**，跟對外網站（Cloudflare **Pages**，`web/`）是兩個獨立部署，互不干擾。原始碼放同一個 repo 只是方便管理。

## 端點

```
GET /registry?id=NCT01234567
```

- `id` 必須是 `NCT` + 8 位數字（Phase 1 只認 ClinicalTrials.gov）。
- 一律回 `application/json`，**連「查無」也是 JSON**（`{found:false}`），讓前端能乾淨地把 Domain 5 降級成 NI、不必處理例外。

### 正規化 schema（穩定介面）

```jsonc
{
  "found": true,
  "registry": "ClinicalTrials.gov",
  "id": "NCT00357721",
  "title": "...",
  "status": "COMPLETED",
  "design": { "allocation": "RANDOMIZED", "model": "CROSSOVER" }, // model 可拿來建議 design 選單
  "dates": {
    "firstSubmitted": "2006-07-25",   // 送交註冊日
    "firstPosted":    "2006-07-27",   // 公開日
    "enrollmentStart":"2006-06"       // 收案起始（可能只到月）
  },
  "prospective": false,               // 註冊日 ≤ 收案起始？true/false/null(資料不全)
  "primaryOutcomes":   [{ "measure": "...", "timeFrame": "..." }],
  "secondaryOutcomes": [{ "measure": "...", "timeFrame": "..." }],
  "url": "https://clinicaltrials.gov/study/NCT00357721"
}
```

回應碼：`200`（找到，或乾淨查無）、`400`（id 格式錯）、`404`（路徑錯）、`502`（上游異常）。
邊緣快取 24h（註冊資料變動慢、對 ctgov 友善）。

### 給 Domain 5 怎麼用

- **5.1（事前計畫）**：看 `prospective` ＋ `dates`。
- **5.2／5.3／5.4**：拿論文報出來的結果，比對 `primaryOutcomes` / `secondaryOutcomes`（是否事後挑、換主要結局、交叉只報第一期）。
- 彩蛋：`design.model === "CROSSOVER"` → 提示使用者切換交叉設計。

## 開發與部署

```bash
cd registry-worker
npm install            # 裝 wrangler（devDependency）

# 本機跑（會真的去打 ctgov）：
npx wrangler dev       # 然後 curl "http://localhost:8787/registry?id=NCT00357721"

# 部署（第一次需登入；登入是互動式、會開瀏覽器）：
npx wrangler login
npx wrangler deploy    # 完成後給你一個 https://rob2-registry.<你的子網域>.workers.dev
```

部署後把那個 workers.dev URL（或之後綁的 `registry.ebmrocket.com`）填進 rob2-rocket 前端的設定，scan 抓到 NCT 後就會打它。

> 在這個 session 裡要跑互動式登入，可在輸入框打 `! npx wrangler login`，輸出會直接進對話。

## 測試

```bash
node test.mjs    # 打真實 ctgov，驗正規化 schema、prospective 邏輯、crossover 偵測、查無路徑
```

## Phase 2（schema 已預留空間）

- 接 **ITMCTR**（傳統醫學專屬）、**ChiCTR**、UMIN/jRCT/KCT——各自一個 normalizer，回同一 schema。
- ctgov **版本歷史**比對：抓「試驗開始前」那一版主要結局，揪事後偷換 outcome。
- 把這個 Worker 核心**包一層 MCP server**，給 Claude Desktop/Code 等 agent 客戶端 agentic 查詢用——核心邏輯一份、兩種門面。
