/**
 * Provider registry — the seam other LLM providers (Gemini, OpenAI) plug into later.
 *
 * For now it only knows 'anthropic'. Lazy per-provider loading (dynamic import)
 * comes in a later phase; for this refactor anthropic.js is a static import so the
 * Claude path is unchanged.
 */

import { createAnthropicAdapter } from "./anthropic.js";

/**
 * Build the adapter for a given provider.
 *
 * @param {string} provider  e.g. "anthropic"
 * @param {object} opts       { apiKey, model, cacheTtl } — passed to the adapter factory
 * @returns {object} the provider adapter (assess / scan / translate / summarize)
 * @throws {Error} on an unknown provider
 */
export async function createAdapter(provider, opts) {
  switch (provider) {
    case "anthropic":
      return createAnthropicAdapter(opts);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
