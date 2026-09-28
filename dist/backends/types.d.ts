/**
 * Backend abstraction. A backend answers a batch of already-screened
 * questions against one state. Adapters (typesafe / openrouter / vercel)
 * translate to each provider's wire format; the rest of jev-use only
 * ever sees these canonical shapes.
 */
import type { Question, State, Usage } from "../protocol.js";
/** One raw answer, before the confidence check that may escalate it. */
export interface RawAnswer {
    /** noul → probability; choice → winning option; score → fractional level index. */
    answer: number | string;
    /** choice/score: distribution, if the provider returns one. */
    distribution?: Record<string, number>;
    /** score: index → level description, if the provider echoes it. */
    legend?: Record<string, string>;
    /**
     * The confidence the PROVIDER itself reported, in [0,1] — set it only when
     * the response actually carried one. Its presence is what makes a verdict's
     * `confidenceFrom` "reported"; when it is absent the engine estimates the
     * confidence from the distribution and says so.
     */
    confidence?: number;
}
/** One batch as an adapter receives it. */
export interface BackendRequest {
    state: State;
    /** Already screened; ids resolved and unique. */
    questions: (Question & {
        id: string;
    })[];
    model?: string;
}
/** One batch as an adapter answers it. */
export interface BackendResponse {
    /** Same order as the request's questions. */
    answers: RawAnswer[];
    model?: string;
    latencyMs?: number;
    usage?: Usage;
}
/** What every backend — remote adapter or local mock — must provide. */
export interface JevBackend {
    /** Short id, surfaced in results: "typesafe" | "openrouter" | ... */
    readonly name: string;
    judge(request: BackendRequest): Promise<BackendResponse>;
}
/** Thrown by adapters on transport/provider failures. */
export declare class BackendError extends Error {
    readonly backend: string;
    readonly status?: number | undefined;
    readonly cause?: unknown;
    /** Provider-requested retry delay, when the response carried one. */
    retryAfterMs?: number;
    constructor(backend: string, message: string, status?: number | undefined, cause?: unknown);
}
