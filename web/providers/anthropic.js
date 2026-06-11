/**
 * Anthropic provider adapter for the RoB 2 engine.
 *
 * This module owns everything Anthropic-shaped: the SDK import, the client
 * creation, the three tool schemas (ASSESS / SCAN / TRANSLATE), and the raw
 * `messages.create` calls. The provider-agnostic core (engine.js) BUILDS prompt
 * text and accumulates usage; this adapter just RELOCATES the original API calls
 * so Claude behaviour stays byte-for-byte identical.
 *
 * The adapter never touches engine state: each method returns its result plus a
 * normalised usage object; the core accumulates usage into state.usage.
 */

// Pinned for reproducibility — bump deliberately, not implicitly. Bare "@anthropic-ai/sdk"
// resolves to the latest release, which could break this deployed static site on an SDK update.
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.104.1";

// ---- step 0: scan the PDF for candidate outcomes (one lightweight call) -------
const SCAN_TOOL = {
  name: "list_outcomes",
  description: "List the outcomes reported in this randomized trial.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "The full title of this trial report, exactly as printed " +
          "(verbatim, including any subtitle such as ': A Randomized " +
          "Clinical Trial'). Empty string if none can be found.",
      },
      doc_type: {
        type: "string",
        enum: ["rct_report", "protocol", "not_rct"],
        description:
          "Classify the document. 'rct_report' = a completed " +
          "randomised controlled trial report that contains results " +
          "(the only valid input for RoB 2). 'protocol' = a study " +
          "protocol, statistical analysis plan, or trial registration " +
          "entry describing a planned trial with NO results yet. " +
          "'not_rct' = anything that is not a randomised controlled " +
          "trial (e.g. observational/cohort study, systematic review " +
          "or meta-analysis, narrative review, case report, guideline).",
      },
      doc_note: {
        type: "string",
        description:
          "If doc_type is NOT 'rct_report', one short sentence in " +
          "Traditional Chinese saying what the document appears to be " +
          "and why. Empty string when doc_type is 'rct_report'.",
      },
      outcomes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The outcome and, if stated, its measure and time point.",
            },
            primary: {
              type: "boolean",
              description: "True if the trial designates this as a primary outcome.",
            },
          },
          required: ["name", "primary"],
        },
      },
    },
    required: ["title", "doc_type", "doc_note", "outcomes"],
  },
};

// ---- structured-output tool for each signalling question ---------------------
const ASSESS_TOOL = {
  name: "submit_assessment",
  description: "Submit the assessment for the single signalling question asked.",
  input_schema: {
    type: "object",
    properties: {
      answer: {
        type: "string",
        enum: ["Y", "PY", "PN", "N", "NI"],
        description: "Y=Yes, PY=Probably yes, PN=Probably no, N=No, NI=No information",
      },
      quote: {
        type: "string",
        description:
          "A verbatim quotation from the trial report supporting the answer. Empty if none.",
      },
      rationale: {
        type: "string",
        description:
          "One or two sentences explaining the answer with reference to the guidance.",
      },
    },
    required: ["answer", "quote", "rationale"],
  },
};

// ---- one-call translator: English quote/rationale → Traditional Chinese -------
const TRANSLATE_TOOL = {
  name: "submit_translations",
  description:
    "Submit the Traditional-Chinese translations for every signalling question item.",
  input_schema: {
    type: "object",
    properties: {
      translations: {
        type: "array",
        description:
          "One entry per input item, in the SAME order, preserving each item's id.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The question id, copied verbatim from the input item.",
            },
            quote_zh: {
              type: "string",
              description:
                "Traditional-Chinese (Taiwan) translation of the item's quote. " +
                "Empty string if the input quote was empty.",
            },
            rationale_zh: {
              type: "string",
              description:
                "Traditional-Chinese (Taiwan) translation of the item's rationale. " +
                "Empty string if the input rationale was empty.",
            },
          },
          required: ["id", "quote_zh", "rationale_zh"],
        },
      },
    },
    required: ["translations"],
  },
};

// Build a PDF document content block. scan uses cache=false → no cache_control.
function pdfBlock(b64, cacheTtl, cache = true) {
  const block = {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: b64 },
  };
  if (cache) block.cache_control = { type: "ephemeral", ttl: cacheTtl };
  return block;
}

// Normalise the SDK usage object into the engine's 4-key shape (getattr-style
// 0-defaults). The core adds these into state.usage.
function normUsage(u) {
  u = u || {};
  return {
    input: u.input_tokens || 0,
    cache_write: u.cache_creation_input_tokens || 0,
    cache_read: u.cache_read_input_tokens || 0,
    output: u.output_tokens || 0,
  };
}

/**
 * Create an Anthropic adapter.
 *
 * @param {object} opts
 * @param {string} opts.apiKey    the user's Anthropic key
 * @param {string} [opts.model]   defaults to claude-sonnet-4-6
 * @param {string} [opts.cacheTtl] ephemeral cache TTL, defaults to "5m"
 * @returns {{ assess, scan, translate, summarize }} adapter
 */
export function createAnthropicAdapter({ apiKey, model = "claude-sonnet-4-6", cacheTtl = "5m" }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  return {
    /**
     * Assess a single signalling question. Carries the original `_ask` API call.
     * @returns {Promise<{answer, quote, rationale, usage:{input,cache_write,cache_read,output}}>}
     */
    async assess({ systemText, pdfBase64, questionPrompt, signal }) {
      const resp = await client.messages.create({
        model,
        max_tokens: 700,
        system: [
          {
            type: "text",
            text: systemText,
            cache_control: { type: "ephemeral", ttl: cacheTtl },
          },
        ],
        tools: [ASSESS_TOOL],
        tool_choice: { type: "tool", name: "submit_assessment" },
        messages: [
          {
            role: "user",
            content: [
              pdfBlock(pdfBase64, cacheTtl, true),
              { type: "text", text: questionPrompt },
            ],
          },
        ],
      });
      const usage = normUsage(resp.usage);
      for (const block of resp.content) {
        if (block.type === "tool_use") {
          const input = block.input;
          return {
            answer: input.answer,
            quote: input.quote,
            rationale: input.rationale,
            usage,
          };
        }
      }
      throw new Error("No tool_use returned for assessment");
    },

    /**
     * Scan a PDF for candidate outcomes. Carries the original `scanOutcomes` body.
     * @returns {Promise<{title, outcomes, doc_type, doc_note, usage}>}
     */
    async scan({ pdfBase64, signal }) {
      const resp = await client.messages.create({
        model,
        max_tokens: 4000,
        tools: [SCAN_TOOL],
        tool_choice: { type: "tool", name: "list_outcomes" },
        messages: [
          {
            role: "user",
            content: [
              pdfBlock(pdfBase64, "5m", false),
              {
                type: "text",
                text:
                  "First classify this document (doc_type): is it a completed randomised " +
                  "controlled trial report with results, a protocol/plan with no results, or " +
                  "not an RCT at all? Then give its full title verbatim, and list every distinct " +
                  "outcome it reports (with measure and time point where given), flagging the " +
                  "primary ones. Do not invent outcomes.",
              },
            ],
          },
        ],
      });
      const usage = normUsage(resp.usage);
      // A truncated reply leaves the tool_use JSON incomplete, so b.input comes back
      // empty even though the call "succeeded". Treat that as a hard error, not [].
      if (resp.stop_reason === "max_tokens") {
        throw new Error(
          "掃描被輸出長度上限截斷(這篇試驗的結局太多)。請改用手動輸入結局," +
            "或回報以便調高上限。"
        );
      }
      let data = {};
      for (const b of resp.content) {
        if (b.type === "tool_use") data = b.input;
      }
      const outcomes = data.outcomes || [];
      const docType = data.doc_type || "rct_report";
      // Only treat "no outcomes" as a hard error for a genuine RCT report (scanned image /
      // unreadable). For a protocol / non-RCT we still return so the caller can show a
      // warning instead.
      if (docType === "rct_report" && outcomes.length === 0) {
        throw new Error(
          "無法從這份 PDF 擷取到任何結局(可能是掃描檔、純圖片、或不是試驗報告)。" +
            "請改用手動輸入結局。"
        );
      }
      // Sort primary outcomes first, then by name (mirrors Python's
      // key=(not primary, name): primary -> 0 sorts before non-primary -> 1).
      outcomes.sort((x, y) => {
        const px = x.primary ? 0 : 1;
        const py = y.primary ? 0 : 1;
        if (px !== py) return px - py;
        const nx = x.name || "";
        const ny = y.name || "";
        return nx < ny ? -1 : nx > ny ? 1 : 0;
      });
      return {
        title: data.title || "",
        outcomes,
        doc_type: docType,
        doc_note: data.doc_note || "",
        usage,
      };
    },

    /**
     * Translate quote/rationale pairs into Traditional Chinese in one call.
     * Carries the original `translateAnswers` body.
     * @returns {Promise<{translations:{[id]:{quote_zh,rationale_zh}}, usage}>}
     */
    async translate({ items, signal }) {
      const list = items || [];
      if (list.length === 0) return { translations: {}, usage: normUsage(null) };
      const payload = list.map((it) => ({
        id: it.id,
        quote: it.quote || "",
        rationale: it.rationale || "",
      }));
      const prompt =
        "以下是一篇隨機對照試驗依 Cochrane RoB 2 工具評讀後、每道訊號問題的「引用原文（quote）」" +
        "與「理由（rationale）」，皆為英文。請把每一項的 quote 與 rationale 都忠實翻譯成" +
        "「繁體中文（台灣用語）」：\n" +
        "- 這是翻譯，不是摘要：請完整翻譯，不要省略、不要改寫成總結。\n" +
        "- 維持臨床與方法學術語的準確；「risk of bias」一律譯為「偏誤風險」（請用「偏誤」，不要用「偏誤」）。\n" +
        "- 若某一項的 quote 或 rationale 是空字串，對應的譯文也回傳空字串。\n" +
        "- 每一項都要回傳，且 id 必須與輸入完全一致。\n" +
        "請呼叫 submit_translations 工具回傳結果。\n\n" +
        `輸入項目（JSON）：\n${JSON.stringify(payload, null, 2)}`;
      const resp = await client.messages.create({
        model,
        max_tokens: 8000,
        tools: [TRANSLATE_TOOL],
        tool_choice: { type: "tool", name: "submit_translations" },
        messages: [{ role: "user", content: prompt }],
      });
      const usage = normUsage(resp.usage);
      // A truncated reply leaves the tool_use JSON incomplete (b.input comes back empty even
      // though the call "succeeded") — treat that as a hard error so the UI can surface it.
      if (resp.stop_reason === "max_tokens") {
        throw new Error("翻譯被輸出長度上限截斷，請回報以便調高上限。");
      }
      let data = null;
      for (const b of resp.content) {
        if (b.type === "tool_use") data = b.input;
      }
      if (!data || !Array.isArray(data.translations)) {
        throw new Error("翻譯失敗：模型未回傳結構化結果。");
      }
      const map = {};
      for (const t of data.translations) {
        if (t && t.id != null) {
          map[t.id] = {
            quote_zh: t.quote_zh || "",
            rationale_zh: t.rationale_zh || "",
          };
        }
      }
      return { translations: map, usage };
    },

    /**
     * Produce a plain-language Chinese summary. Carries the original `_makeSummary`
     * API call (the core builds the prompt text).
     * @returns {Promise<{text, usage}>}
     */
    async summarize({ prompt, signal }) {
      const resp = await client.messages.create({
        model,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });
      const usage = normUsage(resp.usage);
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { text, usage };
    },
  };
}
