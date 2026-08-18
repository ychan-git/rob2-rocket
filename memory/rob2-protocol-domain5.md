---
name: rob2-protocol-domain5
description: RoB2 Rocket 接試驗註冊庫補 Domain 5 的計畫 — Worker 已建未部署、前端未接
metadata: 
  node_type: memory
  type: project
  originSessionId: 4bd76690-c16e-4071-b711-e9402b36ef01
---

RoB2 Rocket（`~/Developer/1-2 專業｜RoB2 rocket`，rob2.ebmrocket.com，純前端、自帶 key）要接**臨床試驗註冊庫**查 protocol，補上 Domain 5（選擇性報告）現在一律 NI 的痛點：拿「論文報的結果」比「事前登記的 outcome/分析計畫」。

**架構決策（2026-07-01 定案，推導不出來的部分）**
- 選 **Cloudflare Worker 正規化器**，不走瀏覽器直打（ctgov v2 無 CORS header，已 curl 實測確認）、也不走 Anthropic MCP connector（只 Claude 能用、破壞 provider-agnostic）。
- **確定性預抓**，不做 agentic tool（符合「LLM 只答題、判斷交程式」鐵律）：scan 抽註冊號 → 打 Worker → 把註冊資料注入 Domain 5 的 system context。
- 同一個 Worker 核心之後可**再包一層 MCP**給 Claude Desktop/Code 用（核心一份、兩種門面）。

**已完成（在 git，commit 7a0bebc）**：`registry-worker/`（放 repo 根、跟 web/ 並列、部署各走各的）。Phase 1 只接 ClinicalTrials.gov（NCT）。輸出穩定 schema：pre-specified primary/secondary outcomes ＋ firstSubmitted/firstPosted/enrollmentStart 兩個日期 ＋ prospective 旗標 ＋ design.model（會回 CROSSOVER）。`test.mjs` 打真實 API 全過。

**還沒做（兩步）**
1. **部署 Worker**：需Bryan醫師互動式 `cd registry-worker && npm install && npx wrangler login`，我再 `wrangler deploy`，拿 workers.dev URL（未來可綁 registry.ebmrocket.com）。
2. **接前端**（會動線上 web/，要小心驗）：scan tool 加 `registration_ids` 欄抓 NCT → 打 Worker → 注入 Domain 5 → UI 顯示抓到的 NCT＋讓使用者確認/更正。彩蛋：design.model=CROSSOVER 時提示切交叉設計（見 [[rob2-crossover-shipped]]）。

**Phase 2 註冊庫**（schema 已預留）：**ITMCTR**（WHO 傳統醫學專屬、TCM 最對口）、**ChiCTR**（中藥大宗但無 API、會擋、最難）、UMIN/jRCT/KCT；ctgov 版本歷史比對揪事後換 outcome。
