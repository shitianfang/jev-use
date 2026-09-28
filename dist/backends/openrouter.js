/**
 * OpenRouter backend. Jev is NOT on /v1/chat/completions there — it lives
 * on the alpha Decisions endpoint, which speaks the native dialect:
 * POST https://openrouter.ai/api/alpha/decisions, Bearer OPENROUTER_API_KEY.
 * (Alpha: OpenRouter may move this path.)
 */
import { parseNativeAnswers, toNativeBody } from "./native.js";
import { postJson } from "./http.js";
export const OPENROUTER_BASE_URL = "https://openrouter.ai";
export const OPENROUTER_DEFAULT_MODEL = "typesafe/jev-latest";
export class OpenRouterBackend {
    options;
    name = "openrouter";
    constructor(options) {
        this.options = options;
    }
    async judge(request) {
        const model = request.model ?? this.options.defaultModel ?? OPENROUTER_DEFAULT_MODEL;
        const body = toNativeBody(request.state, request.questions, model);
        const started = Date.now();
        const response = (await postJson(this.name, `${this.options.baseUrl ?? OPENROUTER_BASE_URL}/api/alpha/decisions`, { Authorization: `Bearer ${this.options.apiKey}` }, body, this.options));
        return {
            answers: parseNativeAnswers(this.name, response.answers, request.questions),
            model: response.model ?? model,
            latencyMs: Date.now() - started,
            usage: {
                inputTokens: response.usage?.input_tokens,
                outputTokens: response.usage?.output_tokens,
            },
        };
    }
}
