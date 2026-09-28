/**
 * TypeSafe direct API — the primary backend.
 * POST https://api.typesafe.ai/v1/systemone, Bearer TYPESAFE_API_KEY.
 * Wire shapes verified against typesafe-ai/typesafe-sdk-js (2026-09).
 */
import { type HttpOptions } from "./http.js";
import type { BackendRequest, BackendResponse, JevBackend } from "./types.js";
export declare const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
export declare const TYPESAFE_DEFAULT_MODEL = "jev-latest";
/** How to reach the TypeSafe API. */
export interface TypeSafeOptions extends HttpOptions {
    apiKey: string;
    /** Override the API origin (self-hosted gateway, test server). */
    baseUrl?: string;
    /** Model used when a call names none. Default "jev-latest". */
    defaultModel?: string;
}
export declare class TypeSafeBackend implements JevBackend {
    private readonly options;
    readonly name = "typesafe";
    constructor(options: TypeSafeOptions);
    judge(request: BackendRequest): Promise<BackendResponse>;
}
