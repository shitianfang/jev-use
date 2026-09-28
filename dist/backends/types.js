/**
 * Backend abstraction. A backend answers a batch of already-screened
 * questions against one state. Adapters (typesafe / openrouter / vercel)
 * translate to each provider's wire format; the rest of jev-use only
 * ever sees these canonical shapes.
 */
/** Thrown by adapters on transport/provider failures. */
export class BackendError extends Error {
    backend;
    status;
    cause;
    /** Provider-requested retry delay, when the response carried one. */
    retryAfterMs;
    constructor(backend, message, status, cause) {
        super(`[${backend}] ${message}`);
        this.backend = backend;
        this.status = status;
        this.cause = cause;
        this.name = "BackendError";
    }
}
