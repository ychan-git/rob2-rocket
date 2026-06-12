/**
 * Google Gemini provider adapter for the RoB 2 engine.
 *
 * Mirrors the Anthropic adapter's interface and return shapes EXACTLY so the
 * provider-agnostic core (engine.js) can swap providers without change. Where
 * Anthropic uses tools + input_schema, Gemini uses responseSchema with
 * responseMimeType:"application/json"; the field names and enums are identical
 * so behaviour stays comparable. Prompt text is shared via shared.js.
 *
 * Caching: Gemini uses *implicit* caching (no explicit cache_control), so the
 * `cacheTtl` option is accepted for interface parity and ignored. Likewise
 * `cache_write` is always 0 in the normalised usage.
 */

// Pinned for reproducibility — bump deliberately, not implicitly.
import { GoogleGenAI } from "https://esm.sh/@google/genai@2.8.0";

// Prompt text is single-sourced in shared.js so it can't drift from anthropic.js.
import { SCAN_PROMPT, buildTranslatePrompt } from "./shared.js";

// ---- responseSchema objects mirroring the Anthropic tool input_schemas -------
// Fields and enums are identical to anthropic.js's ASSESS_TOOL / SCAN_TOOL /
// TRANSLATE_TOOL input_schemas.

const ASSESS_SCHEMA = {
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
};

const SCAN_SCHEMA = {
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
};

const TRANSLATE_SCHEMA = {
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
};

// Normalise Gemini's usageMetadata into the engine's 4-key shape. Gemini reports
// promptTokenCount INCLUSIVE of cached tokens, so input = prompt - cached. There
// is no explicit cache-write step (implicit caching) → cache_write is always 0.
// "thoughts" (2.5 thinking) tokens are billed as output, so fold them in.
function normUsage(um) {
  um = um || {};
  const cacheRead = um.cachedContentTokenCount || 0;
  return {
    input: (um.promptTokenCount || 0) - cacheRead,
    cache_write: 0,
    cache_read: cacheRead,
    output: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
  };
}

// True if the response was cut off by the output-token cap (incomplete JSON).
function isTruncated(res) {
  const fr = res && res.candidates && res.candidates[0] && res.candidates[0].finishReason;
  return fr === "MAX_TOKENS";
}

// A PDF inline-data part for the user content.
function pdfPart(b64) {
  return { inlineData: { mimeType: "application/pdf", data: b64 } };
}

/**
 * Create a Gemini adapter.
 *
 * @param {object} opts
 * @param {string} opts.apiKey      the user's Google Gemini key
 * @param {string} [opts.model]     defaults to gemini-2.5-flash
 * @param {string} [opts.cacheTtl]  accepted for parity; ignored (implicit caching)
 * @returns {{ assess, scan, translate, summarize }} adapter
 */
export function createGeminiAdapter({ apiKey, model = "gemini-3.1-pro", cacheTtl }) {
  const ai = new GoogleGenAI({ apiKey });

  return {
    /**
     * Assess a single signalling question.
     * @returns {Promise<{answer, quote, rationale, usage:{input,cache_write,cache_read,output}}>}
     */
    async assess({ systemText, pdfBase64, questionPrompt, signal }) {
      if (signal?.aborted) throw new Error("Aborted");
      const res = await ai.models.generateContent({
        model,
        config: {
          systemInstruction: systemText,
          responseMimeType: "application/json",
          responseSchema: ASSESS_SCHEMA,
          maxOutputTokens: 2000,
          abortSignal: signal,
        },
        contents: [
          {
            role: "user",
            parts: [pdfPart(pdfBase64), { text: questionPrompt }],
          },
        ],
      });
      const usage = normUsage(res.usageMetadata);
      const data = JSON.parse(res.text);
      return {
        answer: data.answer,
        quote: data.quote,
        rationale: data.rationale,
        usage,
      };
    },

    /**
     * Scan a PDF for candidate outcomes.
     * @returns {Promise<{title, outcomes, doc_type, doc_note, usage}>}
     */
    async scan({ pdfBase64, signal }) {
      if (signal?.aborted) throw new Error("Aborted");
      const res = await ai.models.generateContent({
        model,
        config: {
          responseMimeType: "application/json",
          responseSchema: SCAN_SCHEMA,
          maxOutputTokens: 8000,
          abortSignal: signal,
        },
        contents: [
          {
            role: "user",
            parts: [pdfPart(pdfBase64), { text: SCAN_PROMPT }],
          },
        ],
      });
      const usage = normUsage(res.usageMetadata);
      // A truncated reply leaves the JSON incomplete, so it can't be parsed even
      // though the call "succeeded". Treat that as a hard error, not [].
      if (isTruncated(res)) {
        throw new Error(
          "掃描被輸出長度上限截斷(這篇試驗的結局太多)。請改用手動輸入結局," +
            "或回報以便調高上限。"
        );
      }
      const data = JSON.parse(res.text) || {};
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
     * @returns {Promise<{translations:{[id]:{quote_zh,rationale_zh}}, usage}>}
     */
    async translate({ items, signal }) {
      const list = items || [];
      if (list.length === 0) return { translations: {}, usage: normUsage(null) };
      if (signal?.aborted) throw new Error("Aborted");
      const prompt = buildTranslatePrompt(list);
      const res = await ai.models.generateContent({
        model,
        config: {
          responseMimeType: "application/json",
          responseSchema: TRANSLATE_SCHEMA,
          maxOutputTokens: 16000,
          abortSignal: signal,
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      });
      const usage = normUsage(res.usageMetadata);
      // A truncated reply leaves the JSON incomplete (unparseable) — treat that as
      // a hard error so the UI can surface it.
      if (isTruncated(res)) {
        throw new Error("翻譯被輸出長度上限截斷，請回報以便調高上限。");
      }
      const data = JSON.parse(res.text);
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
     * Produce a plain-language Chinese summary (free text, no schema).
     * @returns {Promise<{text, usage}>}
     */
    async summarize({ prompt, signal }) {
      if (signal?.aborted) throw new Error("Aborted");
      const res = await ai.models.generateContent({
        model,
        config: {
          maxOutputTokens: 2000,
          abortSignal: signal,
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      });
      const usage = normUsage(res.usageMetadata);
      return { text: res.text, usage };
    },
  };
}
