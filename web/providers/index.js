/**
 * Provider registry — the seam every LLM provider (Anthropic, Gemini, …) plugs into.
 *
 * Each provider's module (and its heavy SDK) is loaded via *dynamic import* only
 * when that provider is selected, so the browser downloads just one SDK. The
 * engine already awaits createAdapter(), so the async import is transparent.
 */

/**
 * Build the adapter for a given provider.
 *
 * @param {string} provider  e.g. "anthropic" | "gemini"
 * @param {object} opts       { apiKey, model, cacheTtl } — passed to the adapter factory
 * @returns {Promise<object>} the provider adapter (assess / scan / translate / summarize)
 * @throws {Error} on an unknown provider
 */
export async function createAdapter(provider, opts) {
  if (provider === "anthropic") {
    const m = await import("./anthropic.js");
    return m.createAnthropicAdapter(opts);
  }
  if (provider === "gemini") {
    const m = await import("./gemini.js");
    return m.createGeminiAdapter(opts);
  }
  if (provider === "openai") {
    const m = await import("./openai.js");
    return m.createOpenAIAdapter(opts);
  }
  throw new Error(`Unknown provider: ${provider}`);
}
