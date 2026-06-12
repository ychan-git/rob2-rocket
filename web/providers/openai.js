/**
 * OpenAI provider adapter for the RoB 2 engine.
 *
 * Uses the OpenAI Responses API (supports PDF file inputs natively) + json_schema
 * structured output, mirroring the Anthropic adapter's interface exactly.
 *
 * PDF handling: the file is uploaded via the Files API once on first scan/assess
 * call and the resulting file_id is reused for all subsequent calls in the same
 * adapter instance (22 signalling questions). This avoids re-uploading the same
 * PDF 22 times. Note: uploaded files persist in the user's OpenAI account until
 * manually deleted from https://platform.openai.com/storage/files.
 *
 * Caching: OpenAI uses implicit prompt caching (no explicit cache_control). Cached
 * tokens appear in usage.input_tokens_details.cached_tokens; cache_write is always 0.
 */

// Pinned for reproducibility — bump deliberately, not implicitly.
// ?bundle collapses the SDK's ~20 submodule imports into one file (the un-bundled build's
// long import chain was failing dynamic import in the browser); 5.x has the Responses API.
import OpenAI from "https://esm.sh/openai@5.12.0?bundle&target=es2022";
import { SCAN_PROMPT, buildTranslatePrompt } from "./shared.js";

// ---- JSON schemas for structured output (OpenAI strict json_schema mode) ------
// additionalProperties: false is required for strict mode; all properties must be listed in required.

const ASSESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
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
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      description:
        "The full title of this trial report, exactly as printed " +
        "(verbatim, including any subtitle). Empty string if none can be found.",
    },
    doc_type: {
      type: "string",
      enum: ["rct_report", "protocol", "not_rct"],
      description:
        "Classify the document. 'rct_report' = a completed randomised controlled " +
        "trial report that contains results. 'protocol' = a study protocol or SAP " +
        "with no results. 'not_rct' = anything else.",
    },
    doc_note: {
      type: "string",
      description:
        "If doc_type is NOT 'rct_report', one short sentence in Traditional Chinese " +
        "describing the document. Empty string when doc_type is 'rct_report'.",
    },
    outcomes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
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
  additionalProperties: false,
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
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

// Normalise OpenAI Responses API usage into the engine's 4-key shape.
// cached_tokens live inside input_tokens_details; cache_write is always 0.
function normUsage(u) {
  u = u || {};
  const cached = (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
  return {
    input: (u.input_tokens || 0) - cached,
    cache_write: 0,
    cache_read: cached,
    output: u.output_tokens || 0,
  };
}

// Decode a raw base64 string (no data: prefix) into a Blob for file upload.
function b64ToBlob(b64) {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: "application/pdf" });
}

/**
 * Create an OpenAI adapter.
 *
 * @param {object} opts
 * @param {string} opts.apiKey    the user's OpenAI key (sk-…)
 * @param {string} [opts.model]   defaults to "gpt-4o-mini"
 * @param {string} [opts.cacheTtl] accepted for interface parity; ignored (implicit caching)
 * @returns {{ assess, scan, translate, summarize }} adapter
 */
export function createOpenAIAdapter({ apiKey, model = "gpt-5.4", cacheTtl }) {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });

  // Lazy PDF upload: upload once on first scan/assess call, cache the file_id.
  // Avoids uploading the same PDF 22 times (once per signalling question).
  let _fileIdPromise = null;

  async function getFileId(pdfBase64) {
    if (!_fileIdPromise) {
      _fileIdPromise = (async () => {
        const blob = b64ToBlob(pdfBase64);
        const file = new File([blob], "paper.pdf", { type: "application/pdf" });
        const uploaded = await client.files.create({ file, purpose: "user_data" });
        return uploaded.id;
      })();
    }
    return _fileIdPromise;
  }

  return {
    /**
     * Assess a single signalling question.
     * @returns {Promise<{answer, quote, rationale, usage:{input,cache_write,cache_read,output}}>}
     */
    async assess({ systemText, pdfBase64, questionPrompt, signal }) {
      if (signal?.aborted) throw new Error("Aborted");
      const fileId = await getFileId(pdfBase64);
      if (signal?.aborted) throw new Error("Aborted");
      const resp = await client.responses.create({
        model,
        instructions: systemText,
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", file_id: fileId },
              { type: "input_text", text: questionPrompt },
            ],
          },
        ],
        text: {
          format: { type: "json_schema", name: "assessment", strict: true, schema: ASSESS_SCHEMA },
        },
        max_output_tokens: 700,
      });
      const usage = normUsage(resp.usage);
      const data = JSON.parse(resp.output_text);
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
      const fileId = await getFileId(pdfBase64);
      if (signal?.aborted) throw new Error("Aborted");
      const resp = await client.responses.create({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", file_id: fileId },
              { type: "input_text", text: SCAN_PROMPT },
            ],
          },
        ],
        text: {
          format: { type: "json_schema", name: "scan_result", strict: true, schema: SCAN_SCHEMA },
        },
        max_output_tokens: 8000,
      });
      const usage = normUsage(resp.usage);
      if (resp.status === "incomplete") {
        throw new Error(
          "掃描被輸出長度上限截斷（這篇試驗的結局太多）。請改用手動輸入結局，或回報以便調高上限。"
        );
      }
      const data = JSON.parse(resp.output_text) || {};
      const outcomes = data.outcomes || [];
      const docType = data.doc_type || "rct_report";
      if (docType === "rct_report" && outcomes.length === 0) {
        throw new Error(
          "無法從這份 PDF 擷取到任何結局（可能是掃描檔、純圖片、或不是試驗報告）。" +
            "請改用手動輸入結局。"
        );
      }
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
      const resp = await client.responses.create({
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        text: {
          format: { type: "json_schema", name: "translations", strict: true, schema: TRANSLATE_SCHEMA },
        },
        max_output_tokens: 16000,
      });
      const usage = normUsage(resp.usage);
      if (resp.status === "incomplete") {
        throw new Error("翻譯被輸出長度上限截斷，請回報以便調高上限。");
      }
      const data = JSON.parse(resp.output_text);
      if (!data || !Array.isArray(data.translations)) {
        throw new Error("翻譯失敗：模型未回傳結構化結果。");
      }
      const map = {};
      for (const t of data.translations) {
        if (t && t.id != null) {
          map[t.id] = { quote_zh: t.quote_zh || "", rationale_zh: t.rationale_zh || "" };
        }
      }
      return { translations: map, usage };
    },

    /**
     * Produce a plain-language Chinese summary.
     * @returns {Promise<{text, usage}>}
     */
    async summarize({ prompt, signal }) {
      if (signal?.aborted) throw new Error("Aborted");
      const resp = await client.responses.create({
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        max_output_tokens: 800,
      });
      const usage = normUsage(resp.usage);
      return { text: resp.output_text, usage };
    },

    /**
     * Delete the uploaded PDF file from the user's OpenAI account.
     * Called automatically by the engine after scan/run completes.
     * Errors are swallowed — a missing or already-deleted file is harmless.
     */
    async cleanup() {
      if (!_fileIdPromise) return;
      try {
        const fileId = await _fileIdPromise;
        await client.files.delete(fileId);
      } catch {
        // Silently ignore: file may have already been deleted or never uploaded.
      }
      _fileIdPromise = null;
    },
  };
}
