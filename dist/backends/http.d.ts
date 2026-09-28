/** Shared HTTP plumbing for all remote backends: timeout, retry, errors. */
/** Transport knobs every remote backend accepts. */
export interface HttpOptions {
    /** Abort one attempt after this long. Default 10s. */
    timeoutMs?: number;
    /** Retries on 408/429/5xx and network failures. Default 2. */
    maxRetries?: number;
}
/**
 * POST JSON and return the parsed body, retrying what is worth retrying.
 * Every failure surfaces as a `BackendError` naming the backend and status,
 * so the engine can degrade to an escalation with a readable hint.
 */
export declare function postJson(backend: string, url: string, headers: Record<string, string>, body: unknown, options?: HttpOptions): Promise<unknown>;
