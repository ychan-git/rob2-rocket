/**
 * Provider-agnostic PROMPT TEXT, single-sourced so adapters can't drift.
 *
 * The scan instruction and the translate prompt are the *only* free-text
 * prompts that two adapters must produce identically (the assess prompt and the
 * summary prompt are built by engine.js and passed in). They live here so that
 * adding a new provider (Gemini, OpenAI, …) reuses the EXACT same wording — a
 * reworded prompt would silently change behaviour and make cross-provider
 * comparisons meaningless.
 *
 * These strings were lifted VERBATIM from anthropic.js; do not reword them.
 */

// The scan text part — classify the document, give the verbatim title, list
// every distinct outcome (primary flagged). Copied byte-for-byte from the
// original anthropic.js `scan` call.
export const SCAN_PROMPT =
  "First classify this document (doc_type): is it a completed randomised " +
  "controlled trial report with results, a protocol/plan with no results, or " +
  "not an RCT at all? Then give its full title verbatim, and list every distinct " +
  "outcome it reports (with measure and time point where given), flagging the " +
  "primary ones. Do not invent outcomes.";

/**
 * Build the Traditional-Chinese translate prompt for a list of items.
 * Copied byte-for-byte from the original anthropic.js `translate` call.
 *
 * @param {Array<{id, quote, rationale}>} items  English items; either field may be ""
 * @returns {string} the prompt text (includes the JSON payload)
 */
export function buildTranslatePrompt(items) {
  const list = items || [];
  const payload = list.map((it) => ({
    id: it.id,
    quote: it.quote || "",
    rationale: it.rationale || "",
  }));
  return (
    "以下是一篇隨機對照試驗依 Cochrane RoB 2 工具評讀後、每道訊號問題的「引用原文（quote）」" +
    "與「理由（rationale）」，皆為英文。請把每一項的 quote 與 rationale 都忠實翻譯成" +
    "「繁體中文（台灣用語）」：\n" +
    "- 這是翻譯，不是摘要：請完整翻譯，不要省略、不要改寫成總結。\n" +
    "- 維持臨床與方法學術語的準確；「risk of bias」一律譯為「偏誤風險」（請用「偏誤」，不要用「偏倚」）。\n" +
    "- 若某一項的 quote 或 rationale 是空字串，對應的譯文也回傳空字串。\n" +
    "- 每一項都要回傳，且 id 必須與輸入完全一致。\n" +
    "請呼叫 submit_translations 工具回傳結果。\n\n" +
    `輸入項目（JSON）：\n${JSON.stringify(payload, null, 2)}`
  );
}
