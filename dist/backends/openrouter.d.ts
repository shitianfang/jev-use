/**
 * OpenRouter backend. Jev is NOT on /v1/chat/completions there — it lives
 * on the alpha Decisions endpoint, which speaks the native dialect:
 * POST https://openrouter.ai/api/alpha/decisions, Bearer OPENROUTER_API_KEY.
 * (Alpha: OpenRouter may move this path.)
 */
import { type HttpOptions } from "./http.js";
import type { BackendRequest, BackendResponse, JevBackend } from "./types.js";
export declare const OPENROUTER_BASE_URL = "https://openrouter.ai";
export declare const OPENROUTER_DEFAULT_MODEL = "typesafe/jev-latest";
/** How to reach OpenRouter's decisions endpoint. */
export interface OpenRouterOptions extends HttpOptions {
    apiKey: string;
    /** Override the API origin (proxy, test server). */
    baseUrl?: string;
    /** Model used when a call names none. Default "typesafe/jev-latest". */
    defaultModel?: string;
}
export declare class OpenRouterBackend implements JevBackend {
    private readonly options;
    readonly name = "openrouter";
    constructor(options: OpenRouterOptions);
    judge(request: BackendRequest): Promise<BackendResponse>;
}
