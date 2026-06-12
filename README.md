# RoB2 Rocket

> 用 AI 照 **Cochrane 官方 RoB 2 手冊**，**逐題、各自獨立**評讀單一隨機對照試驗結果的偏誤風險（risk of bias）。純前端網頁、自帶 API key、費用自付。
>
> *An in-browser tool that runs a Cochrane RoB 2 risk-of-bias assessment one signalling question at a time. Bring your own API key. (English summary at the bottom ↓)*

🌐 **線上版 / Live：[rob2.ebmrocket.com](https://rob2.ebmrocket.com)**

> 主要說明為繁體中文；英文摘要見文末 [English summary](#english-summary)。

---

## 這是什麼

RoB 2 評的是**單一結果**（一個 outcome、一種 effect of interest）的偏誤風險，分 5 個 domain、22 個訊號問題。這個工具把它變成一個**可重現、可稽核**的流程：

- **不是**把論文丟給 AI 問「整體風險多少」。
- 而是讓 AI **一題一題、各自獨立**回答 22 個訊號問題（prompt 直接取自官方手冊）。
- **總風險由官方流程圖的判斷演算法用程式算出**，不是 AI 的語意判斷。

## 設計理念：怎麼把官方手冊變成可重現的 AI 流程

- **官方指引編成結構化知識庫**（`web/rob2_knowledge.json`）：5 個 domain、22 個訊號問題、官方詳細指引（逐字）、各題的條件適用邏輯、以及官方判斷演算法表格。
- **每題獨立、無狀態**：每個訊號問題開一個全新的模型呼叫，只看知識庫 + 試驗 PDF，**看不到其他題的答案**——對應 RoB 2「答案必須彼此獨立」的規定。
- **判斷用算的、不是用猜的**：模型只負責回答 22 題；每個 domain 與 overall 的判斷由程式跑官方決策表得出——確定、可重現、可追溯到確切答案（`web/algorithm.js`；`web/algorithm.test.js` 對照官方表格驗證邏輯）。
- **條件路由**：依先前答案不適用的題目自動跳過、記為「不適用（NA）」，照手冊規定。

模型的角色刻意限縮且可稽核——只給「單題答案 + 一段原文逐字引述 + 簡短理由」；domain 與 overall 的結論一律來自公開演算法，不交給模型自由發揮。

## 怎麼跑

純靜態網頁，**無後端、免安裝**。把 `web/` 資料夾用 http 服務起來打開即可：

```bash
cd web
python3 -m http.server 7700
# 開 http://localhost:7700/
```

（模組 import 與知識庫 fetch 需要 `http://`，直接用 `file://` 開不會動；任何靜態伺服器都行，例如 `npx serve`。）部署成公開網站見 [`web/DEPLOY.md`](web/DEPLOY.md)。

## 自帶 API key 與隱私

在介面選供應商（**Claude（Anthropic）／Gemini（Google）／ChatGPT（OpenAI）**）並填入**你自己的 API key**，費用自付。建議到供應商 Console 另開一把**設了花費上限、可隨時撤銷的專用 key**。

**你的 key 不會離開你的瀏覽器。** 本工具無後端，key 只會直接送往你選的供應商、不送給我們或任何第三方。預設只留在當前分頁，要記在這台裝置是你自己勾選才會。你可以在瀏覽器 DevTools →「Network」分頁自行核對。

## 怎麼用

RoB 2 評的是**單一結果**、不是整篇試驗。上傳一篇 RCT 的 PDF，讓工具掃描列出候選結局供你挑、或自己輸入結局；選 effect of interest——**指派介入（ITT）** 或 **遵從介入（per-protocol）**（後者會把 Domain 2 切換成另一套題目）。接著即時看每題被回答、流程圖顯示哪些題被跳過及原因，最後把完整結果（每題答案、原文引述、理由）匯出成 Markdown、列印／PDF 或純文字。

## 解讀結果與限制

- 照手冊：**Yes／Probably-yes** 視為同一類、**No／Probably-no** 視為同一類。
- **Domain 5（選擇性報告）** 只看全文。沒有 protocol／註冊資料時常會是「無資訊（NI）」——這是預期內的,也反映多數評讀者沒有那些文件時的實況。
- 這是**輔助決策工具,不能取代專家評讀者**。

## 出處 Attribution

本工具建立在 Cochrane **RoB 2** 之上：Sterne JAC, Savović J, Page MJ, et al. *RoB 2: a revised tool for assessing risk of bias in randomised trials.* BMJ 2019;366:l4898. 偏誤風險框架、domain、訊號問題皆為 RoB 2 開發小組的成果。請引用原始工具、並參考官方指引 <https://www.riskofbias.info/>。本工具為獨立專案,未經 RoB 2 開發小組或 Cochrane 背書或隸屬。

`web/rob2_knowledge.json` 中的 RoB 2 指引文字(詳細 domain 指引、訊號問題說明、preliminary considerations)為上述官方指引的**逐字重製**,僅重排成 JSON、未改動文字。其著作權仍屬原作者,以 **CC BY-NC-ND 4.0**(<https://creativecommons.org/licenses/by-nc-nd/4.0/>)授權,於此標註出處、供非商業使用。

## 授權 License

- **原創程式碼**(RoB 2 指引文字以外的一切)—— **MIT License**,見 [`LICENSE`](LICENSE)。
- **`web/rob2_knowledge.json` 的 RoB 2 指引文字** —— © RoB 2 作者,**CC BY-NC-ND 4.0**(逐字重製,見上方出處)。

由於內含 CC BY-NC-ND 內容,本工具整體為**非商業**用途。

## 引用 How to cite

若你在研究中使用本工具,請引用它(GitHub 會依 [`CITATION.cff`](CITATION.cff) 顯示「Cite this repository」按鈕),**並一併引用原始 RoB 2 工具**(Sterne et al., BMJ 2019;366:l4898,見上方出處)。

---

## English summary

**RoB2 Rocket** runs a **Cochrane RoB 2** risk-of-bias assessment for a *single* randomized-trial result, entirely in your browser. (The interface is in Traditional Chinese.) Live at **[rob2.ebmrocket.com](https://rob2.ebmrocket.com)**.

- **One question at a time, independently.** Each of the 22 signalling questions is answered by a fresh, stateless model call that sees only the official guidance and the trial PDF — never the other answers — mirroring the RoB 2 independence rule.
- **Judgements are computed, not guessed.** The model only answers the questions; each domain and the overall verdict are derived by running the official RoB 2 decision tables in code (`web/algorithm.js`) — deterministic, reproducible, traceable. Conditional routing skips inapplicable questions automatically.
- **Bring your own API key** (Claude / Gemini / ChatGPT). No backend; the key never leaves your browser and is sent only to the provider you choose.
- **Run it:** static site, no install — `cd web && python3 -m http.server 7700`, then open `http://localhost:7700/`. Deploy notes in [`web/DEPLOY.md`](web/DEPLOY.md).
- **Limits:** treat Yes/Probably-yes and No/Probably-no as single responses; Domain 5 is full-text-only and is often "No information" without a protocol; this is decision-support, not a replacement for an expert reviewer.

**Attribution & license:** Built on Cochrane RoB 2 (Sterne et al., *BMJ* 2019;366:l4898; <https://www.riskofbias.info/>) — an independent tool, not endorsed by or affiliated with the RoB 2 group or Cochrane. Source code is **MIT**; the RoB 2 guidance text in `web/rob2_knowledge.json` is reproduced verbatim and remains **CC BY-NC-ND 4.0** by its authors, so the tool as a whole is for **non-commercial** use. Please cite this tool (see [`CITATION.cff`](CITATION.cff)) **and** the original RoB 2 tool.
