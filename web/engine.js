/**
 * RoB 2 assessment engine — browser port of engine.py's RoB2Engine + scan_outcomes.
 *
 * For each signalling question it spins up a fresh, stateless Claude call (a "subagent"):
 * the model sees only the RoB 2 knowledge base + the RCT, never the answers to other
 * questions. This enforces the RoB 2 rule that answers must be independent, and keeps
 * each context small (no history bloat).
 *
 * RoB 2 assesses ONE result (a specific outcome) under ONE effect of interest
 * (assignment-to-intervention = ITT, or adhering-to-intervention = per-protocol). The
 * chosen result and effect are injected into every question prompt. For the adhering
 * effect, the domain-2 questions and algorithm switch to the per-protocol variant
 * (Box 7 / Tables 7-8).
 *
 * Cost control via prompt caching: the knowledge base (system) and the RCT PDF (document)
 * are cached blocks, written once and read for every question (~10% of normal input cost).
 *
 * Provider seam: this core is provider-agnostic. It BUILDS prompt text, owns the run()
 * flow / cancellation / usage accumulation / state shape, and delegates every API call
 * to a provider adapter (web/providers/). The Anthropic adapter carries the exact
 * relocated Claude calls and tool schemas, so Claude behaviour is byte-for-byte identical.
 *
 * Browser adaptation (vs. engine.py):
 *   - No file/disk access: the KB object and the PDF base64 are passed into the constructor
 *     (the browser fetches the KB and reads the PDF via FileReader).
 *   - The API key is passed in and used with `dangerouslyAllowBrowser: true` (the user
 *     supplies their own key, stored only in their browser; see CLAUDE.md).
 *   - No threading: run() is async; cancellation uses an AbortSignal instead of a
 *     threading.Event. signal?.aborted is checked at the same points _cancelled() was.
 */

import { isApplicable, judgeDomain, judgeOverall } from "./algorithm.js";
import { createAdapter } from "./providers/index.js";

const EFFECT_LABEL = {
  assignment: "effect of assignment to intervention (intention-to-treat effect)",
  adhering: "effect of adhering to intervention (per-protocol effect)",
};

/**
 * Translate every answer's English `quote` and `rationale` into Traditional Chinese
 * in ONE API call (cost-saving: a single request covers all ~22 questions).
 *
 * @param {object}   opts
 * @param {string}   opts.apiKey   the user's Anthropic key
 * @param {Array}    opts.items    [{ id, quote, rationale }] — English; either field may be ""
 * @param {string}   [opts.model]  defaults to claude-sonnet-4-6 (matches the rest of the app)
 * @param {string}   [opts.provider] defaults to "anthropic"
 * @returns {Promise<Object>} { translations: { [id]: { quote_zh, rationale_zh } },
 *                              usage: { input, cache_write, cache_read, output } }
 * @throws  {Error} on truncation or a missing tool_use reply, so the UI can surface it
 */
export async function translateAnswers({
  apiKey,
  items,
  model = "claude-sonnet-4-6",
  provider = "anthropic",
}) {
  const list = items || [];
  if (list.length === 0)
    return { translations: {}, usage: { input: 0, cache_write: 0, cache_read: 0, output: 0 } };
  const adapter = await createAdapter(provider, { apiKey, model });
  return await adapter.translate({ items: list }); // { translations, usage }
}

/**
 * Scan a PDF for candidate outcomes (one lightweight call).
 *
 * Returns { title, outcomes: [{name, primary}], doc_type, doc_note }, primary outcomes
 * first. The title is the trial report's own title (used to identify the trial in the
 * live header and in the exported report), so the user doesn't have to type it.
 *
 * Throws Error if the scan can't be completed (e.g. the model's reply was truncated, or
 * no outcome could be extracted) so the caller can surface a real error to the user
 * instead of silently showing an empty list.
 */
export async function scanOutcomes({
  apiKey,
  pdfBase64,
  model = "claude-sonnet-4-6",
  provider = "anthropic",
  cacheTtl,
}) {
  const adapter = await createAdapter(provider, { apiKey, model, cacheTtl });
  try {
    const { title, outcomes, doc_type, doc_note, usage } = await adapter.scan({ pdfBase64 });
    return { title, outcomes, doc_type, doc_note, usage };
  } finally {
    // Fire-and-forget cleanup (noop for Anthropic/Gemini; deletes uploaded file for OpenAI).
    Promise.resolve(adapter.cleanup?.()).catch(() => {});
  }
}

export class RoB2Engine {
  constructor({
    apiKey,
    kb,
    pdfBase64,
    resultOutcome = "",
    effect = "assignment",
    model = "claude-sonnet-4-6",
    cacheTtl = "5m",
    provider = "anthropic",
    onUpdate = () => {},
    signal,
  }) {
    this.kb = kb;
    this.model = model;
    this.cacheTtl = cacheTtl;
    this.effect = effect === "adhering" ? "adhering" : "assignment";
    this.result = resultOutcome || "(the trial's primary outcome)";
    this.domains = this._activeDomains();
    this.systemText = this._buildSystemText();
    this.pdfB64 = pdfBase64;
    // createAdapter is async (the seam for lazy per-provider loading later); the
    // constructor stays sync, so we hold the promise and await it where the call is made.
    this.adapterP = createAdapter(provider, { apiKey, model, cacheTtl });
    this.onUpdate = onUpdate || (() => {});
    this.signal = signal; // AbortSignal; aborted externally to cancel mid-run
    // Prompt-cache warm-up gate: the first assess() call runs alone to write the
    // shared cache block; the rest wait on this promise, then fire concurrently.
    this._warmStarted = false;
    this._warmReady = new Promise((res) => { this._warmResolve = res; });
    this.order = this.domains.flatMap((d) => d.questions.map((q) => q.id));
    this.qlookup = {};
    for (const d of this.domains) {
      for (const q of d.questions) this.qlookup[q.id] = [d, q];
    }
    this.state = {
      status: "idle",
      model: this.model,
      effect: this.effect,
      result: this.result,
      current: {}, // { [domainId]: qid|null } — one in-flight question per parallel domain
      answers: {},
      domains: {},
      overall: null,
      usage: { input: 0, cache_write: 0, cache_read: 0, output: 0 },
    };
  }

  _activeDomains() {
    // Swap domain 2 for the adhering variant when needed (keeps its guidance).
    const doms = this.kb.domains.map((d) => ({ ...d }));
    if (this.effect === "adhering") {
      const d2 = doms.find((d) => d.id === 2);
      const adh = this.kb.domain2_adhering;
      d2.name = adh.name;
      d2.questions = adh.questions;
      // detailed_guidance left in place — it covers both effects
    }
    return doms;
  }

  _buildSystemText() {
    const kb = this.kb;
    const parts = [];
    parts.push(
      "You are an expert systematic-review methodologist applying the Cochrane " +
        "RoB 2 tool to a SINGLE result of a randomized trial. You assess ONE " +
        "signalling question at a time. Base every answer ONLY on the trial report " +
        "provided and the official guidance below. Do not infer unsupported information.\n"
    );
    parts.push(`TOOL: ${kb.tool} (${kb.version})`);
    parts.push(`DESIGN: ${kb.design}`);
    parts.push(`EFFECT OF INTEREST: ${EFFECT_LABEL[this.effect]}`);
    parts.push(`RESULT BEING ASSESSED: ${this.result}\n`);
    parts.push("RESPONSE OPTIONS:");
    for (const [code, desc] of Object.entries(kb.response_options)) {
      parts.push(`  ${code} = ${desc}`);
    }
    parts.push("\nGLOBAL INSTRUCTIONS:");
    for (const i of kb.global_instructions) {
      parts.push(`  - ${i}`);
    }
    parts.push("\nPRELIMINARY CONSIDERATIONS:\n" + kb.preliminary_considerations + "\n");
    for (const dom of this.domains) {
      parts.push(`\n===== DOMAIN ${dom.id}: ${dom.name} =====`);
      parts.push("\nDETAILED GUIDANCE:");
      for (const s of dom.detailed_guidance || []) {
        parts.push(`\n[${s.section}] ${s.title}\n${s.text}`);
      }
      parts.push("\nSIGNALLING QUESTIONS (elaboration):");
      for (const q of dom.questions) {
        const cond = q.condition ? ` (Conditional: ${q.condition})` : "";
        parts.push(`\n${q.id} ${q.text}${cond}\n${q.elaboration}`);
      }
    }
    return parts.join("\n");
  }

  _questionPrompt(qid) {
    const [dom, q] = this.qlookup[qid];
    const rel = q.relevant_guidance_sections || [];
    const relTxt = rel.length
      ? ` Most relevant guidance sections: ${rel.join(", ")}.`
      : "";
    return (
      `Assess signalling question ${qid} of Domain ${dom.id} (${dom.name}).\n\n` +
      `RESULT BEING ASSESSED: ${this.result}\n` +
      `EFFECT OF INTEREST: ${EFFECT_LABEL[this.effect]}\n\n` +
      `Question ${qid}: ${q.text}\n\n` +
      `Elaboration: ${q.elaboration}${relTxt}\n\n` +
      `Allowed answers: ${q.options.join(", ")}.\n` +
      "Read the attached trial report and assess this question FOR THE RESULT NAMED " +
      "ABOVE. Then call submit_assessment with your answer, a supporting verbatim " +
      "quote, and a brief rationale."
    );
  }

  _cancelled() {
    return this.signal != null && this.signal.aborted;
  }

  _emit() {
    this.onUpdate(this.state);
  }

  _accumulateUsage(u) {
    u = u || {};
    this.state.usage.input += u.input || 0;
    this.state.usage.cache_write += u.cache_write || 0;
    this.state.usage.cache_read += u.cache_read || 0;
    this.state.usage.output += u.output || 0;
  }

  async _ask(qid) {
    const adapter = await this.adapterP;
    const args = {
      systemText: this.systemText,
      pdfBase64: this.pdfB64,
      questionPrompt: this._questionPrompt(qid),
      signal: this.signal,
    };
    // Cache warm-up: the very first assess() runs ALONE and writes the shared cache
    // block (KB system + PDF document). Every other call waits for it, then fires
    // concurrently — so the parallel domains all hit the warm cache (~0.1× input)
    // instead of each paying a separate cache write (1.25×). No extra tokens: the
    // warming call is simply one of the 22 questions.
    let res;
    if (!this._warmStarted) {
      this._warmStarted = true;
      try {
        res = await adapter.assess(args);
      } finally {
        this._warmResolve(); // release the gate even if the warming call failed
      }
    } else {
      await this._warmReady;
      res = await adapter.assess(args);
    }
    const { answer, quote, rationale, usage } = res;
    this._accumulateUsage(usage);
    return { answer, quote, rationale };
  }

  async run() {
    this.state.status = "running";
    this._emit();
    try { return await this._run(); } finally {
      // Fire-and-forget cleanup (noop for Anthropic/Gemini; deletes uploaded file for OpenAI).
      this.adapterP.then(a => Promise.resolve(a.cleanup?.()).catch(() => {})).catch(() => {});
    }
  }

  async _run() {
    // Run all domains CONCURRENTLY. RoB 2 domains are independent — no domain's
    // answers affect another's questions (isApplicable only reads within-domain
    // answers) — so parallelism is faithful to the tool, not a shortcut. Within a
    // domain the questions stay sequential (conditional routing needs prior answers).
    // Wall-clock drops from ~22 questions to ~the longest single domain. The first
    // question to fire warms the prompt cache (see _ask); the rest then run in parallel.
    const results = await Promise.allSettled(this.domains.map((d) => this._runDomain(d)));
    if (this._cancelled()) return this.state;

    // Error isolation: a failing domain doesn't abort the others (allSettled lets
    // them finish), but we surface the first failure so the UI shows a real error.
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      const e = failed.reason;
      throw e instanceof Error ? e : new Error(e ? String(e) : "assessment failed");
    }

    this.state.overall = judgeOverall(this.state.domains);
    this.state.current = {};
    // plain-language Chinese summary for non-specialists
    this.state.status = "summarizing";
    this._emit();
    if (this._cancelled()) return this.state;
    try {
      this.state.summary = await this._makeSummary();
    } catch (e) {
      this.state.summary = "（中文摘要產生失敗：" + (e && e.message ? e.message : e) + "）";
    }
    this.state.status = "done";
    this._emit();
    return this.state;
  }

  // One sequential lane over a single domain's questions (runs concurrently with
  // the other domains' lanes). Throws on an API failure so _run can surface it.
  async _runDomain(dom) {
    for (const q of dom.questions) {
      if (this._cancelled()) return;
      const qid = q.id;
      // Check applicability BEFORE announcing as current — avoids a transient state
      // where the UI shows current=2.7 while 2.6=N (lighting the wrong flowchart arc).
      if (!isApplicable(qid, this.state.answers, this.effect)) {
        this.state.answers[qid] = {
          answer: "NA",
          quote: "",
          rationale: "Not applicable given previous answers (conditional question).",
          ts: Date.now() / 1000,
        };
        this._maybeJudgeDomain(qid); // a domain whose LAST question is NA must still be judged
        this._emit();
        continue;
      }
      this.state.current[dom.id] = qid;
      this._emit();
      const result = await this._ask(qid);
      if (this._cancelled()) return;
      result.ts = Date.now() / 1000;
      this.state.answers[qid] = result;
      this.state.current[dom.id] = null;
      this._maybeJudgeDomain(qid);
      this._emit();
    }
    this.state.current[dom.id] = null;
  }

  async _makeSummary() {
    // One extra call: read all answers + judgements, write a Chinese limitations summary.
    const lines = [
      `試驗：${this.state.result}`,
      `效應：${EFFECT_LABEL[this.effect]}`,
      `Overall：${this.state.overall}`,
      "",
    ];
    for (const dom of this.domains) {
      const dj = this.state.domains[dom.id];
      lines.push(`Domain ${dom.id} ${dom.name} — ${dj === undefined ? "?" : dj}`);
      for (const q of dom.questions) {
        const a = this.state.answers[q.id];
        if (!a) continue;
        lines.push(`  ${q.id} [${a.answer}] ${a.rationale || ""}`);
      }
      lines.push("");
    }
    const transcript = lines.join("\n");
    const prompt =
      "以下是一篇隨機對照試驗依 Cochrane RoB 2 工具完成的偏誤風險評讀結果" +
      "（每題的答案與理由皆為英文）。請用「繁體中文」寫一段給一般讀者（非方法學專家）" +
      "看的白話摘要，說明這篇論文在這個結局上的偏誤風險與主要 limitation 在哪裡、" +
      "為什麼。請：(1) 先用一句話總結 overall 風險；(2) 點出風險較高或有疑慮的 domain " +
      "並解釋白話原因；(3) 若某些判斷受限於『只看全文、未取得 protocol』，請說明；" +
      "(4) 控制在約 200–350 字，不要逐題羅列，不要用 Markdown 標題。\n\n" +
      `評讀結果：\n${transcript}`;
    const adapter = await this.adapterP;
    const { text, usage } = await adapter.summarize({ prompt, signal: this.signal });
    this._accumulateUsage(usage);
    return text;
  }

  _maybeJudgeDomain(qid) {
    for (const dom of this.domains) {
      const qids = dom.questions.map((q) => q.id);
      if (qid === qids[qids.length - 1] && qids.every((q) => q in this.state.answers)) {
        this.state.domains[dom.id] = judgeDomain(dom.id, this.state.answers, this.effect);
      }
    }
  }
}
