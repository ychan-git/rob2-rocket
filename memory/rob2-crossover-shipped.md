---
name: rob2-crossover-shipped
description: RoB2 Rocket 交叉試驗支援已上線 + PP 路由修正 + 一個跨專案待修 bug
metadata: 
  node_type: memory
  type: project
  originSessionId: 4bd76690-c16e-4071-b711-e9402b36ef01
---

RoB2 Rocket（`~/Developer/1-2 專業｜RoB2 rocket`，web/）2026-07-01 已加**交叉（AB/BA）試驗支援**並上線：design 選單、Domain S（期間與殘留，Fig 2）、Domain 5 多 5.4（Fig 7）、平行/交叉雙 KB。核心邏輯在 `web/algorithm.js` + `web/rob2_knowledge_crossover.json`，oracle 從 tcm skill 的 `algorithm_crossover.py` 1:1 移植進 `web/algorithm.test.js`。Bryan醫師已對著官方 Fig 2/Fig 7 人工核過決策表（我用 mermaid 畫給他核）。

**跨專案待修 bug（推導不出來、值得記）**：`isApplicable` 的 adhering(PP) 分支原本底部有個 `return true`，會跳過 Domain 3/4 的條件路由（PP 下 3.2–3.4/4.3–4.5 一律被問），且因 `judgeDomain4` 第一行讀 4.5，有一條罕見路徑會把 Low 誤翻成 High。**rob2-rocket web 已修**（commit 08cacce，改成 fall through、ITT 的 D2 路由用 `effect!=="adhering"` 包起來）。但**源頭 `~/Developer/1-1 中醫現代研究資料庫/skills/rob2-assess/algorithm_parallel.py` 還帶同一個 bug**（只有 `algorithm_crossover.py` 是對的）——PP 效應才會發作、批次預設 ITT 所以沒踩到，但兩檔不一致，哪天要對齊。

延伸：接註冊庫補 Domain 5 的計畫見 [[rob2-protocol-domain5]]。
