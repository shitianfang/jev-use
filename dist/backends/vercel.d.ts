/**
 * Vercel AI Gateway backend. A genuinely different dialect:
 * POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model with the model
 * in a HEADER (ai-model-id), `noul` renamed to `boolean` (answer field
 * `probability`), camelCase usage, no legend echo, and Jev's confidence head
 * relayed out-of-band in `providerMetadata.typesafe.confidence` — a map keyed
 * by question id that carries `choice` and `score` answers and omits `boolean`
 * ones, so a mixed batch comes back part reported, part estimated.
 * Wire shapes verified against @ai-sdk/gateway dist source and 283 live
 * responses (2026-09-19).
 */
import { type HttpOptions } from "./http.js";
import { type BackendRequest, type BackendResponse, type JevBackend } from "./types.js";
export declare const VERCEL_BASE_URL = "https://ai-gateway.vercel.sh";
export declare const VERCEL_DEFAULT_MODEL = "typesafe-ai/jev";
/** How to reach the Vercel AI Gateway. */
export interface VercelOptions extends HttpOptions {
    apiKey: string;
    /** Override the gateway origin (proxy, test server). */
    baseUrl?: string;
    /** Model used when a call names none. Default "typesafe-ai/jev". */
    defaultModel?: string;
}
export declare class VercelBackend implements JevBackend {
    private readonly options;
    readonly name = "vercel";
    constructor(options: VercelOptions);
    judge(request: BackendRequest): Promise<BackendResponse>;
}
