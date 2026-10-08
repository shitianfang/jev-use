/** Shared HTTP plumbing for all remote backends: timeout, retry, errors. */

import { BackendError } from "./types.js";

/** Transport knobs every remote backend accepts. */
export interface HttpOptions {
  /** Abort one attempt after this long. Default 10s. */
  timeoutMs?: number;
  /** Retries on 408/429/5xx and network failures. Default 2. */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5_000;

/**
 * POST JSON and return the parsed body, retrying what is worth retrying.
 * Every failure surfaces as a `BackendError` naming the backend and status,
 * so the engine can degrade to an escalation with a readable hint.
 */
export async function postJson(
  backend: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  let lastError: BackendError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay(attempt, lastError));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) {
        return (await response.json()) as unknown;
      }
      const message = await extractErrorMessage(response);
      lastError = new BackendError(
        backend,
        `HTTP ${response.status}: ${message}`,
        response.status,
      );
      lastError.retryAfterMs = parseRetryAfter(response);
      if (!isRetryable(response.status) || attempt === maxRetries) throw lastError;
    } catch (error) {
      if (error instanceof BackendError) {
        if (attempt === maxRetries || !isRetryable(error.status)) throw error;
        continue;
      }
      const aborted = (error as Error)?.name === "AbortError";
      lastError = new BackendError(
        backend,
        aborted
          ? `request timed out after ${timeoutMs}ms`
          : `network error: ${String(error)}`,
        undefined,
        error,
      );
      if (attempt === maxRetries) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw lastError ?? new BackendError(backend, "unreachable");
}

function isRetryable(status?: number): boolean {
  if (status === undefined) return true; // network / timeout
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(attempt: number, lastError?: BackendError): number {
  if (lastError?.retryAfterMs !== undefined) {
    return Math.min(lastError.retryAfterMs, 60_000);
  }
  const base = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
  return base * (1 + Math.random() * 0.25);
}

function parseRetryAfter(response: Response): number | undefined {
  const milliseconds = response.headers.get("retry-after-ms");
  if (milliseconds && Number.isFinite(Number(milliseconds))) {
    return Number(milliseconds);
  }
  const seconds = response.headers.get("retry-after");
  if (seconds && Number.isFinite(Number(seconds))) return Number(seconds) * 1000;
  if (seconds) {
    let httpDate = seconds;
    const legacy = seconds.match(/^([A-Za-z]+, \d{2}-[A-Za-z]{3}-)(\d{2})( \d{2}:\d{2}:\d{2} GMT)$/);
    if (legacy) {
      // RFC 850 years use a moving 50-year future window, not JS's fixed pivot.
      const latest = new Date();
      latest.setUTCFullYear(latest.getUTCFullYear() + 50);
      let year = Math.floor(latest.getUTCFullYear() / 100) * 100 + Number(legacy[2]);
      httpDate = `${legacy[1]}${year}${legacy[3]}`;
      if (Date.parse(httpDate) > latest.getTime()) {
        year -= 100;
        httpDate = `${legacy[1]}${year}${legacy[3]}`;
      }
    } else if (/^[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(seconds)) {
      // The obsolete asctime form has no zone, but still denotes UTC.
      httpDate = `${seconds} GMT`;
    }
    const date = Date.parse(httpDate);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return undefined;
}

/** Dig the provider's own message out of an error body, whatever shape it is. */
async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const value = data[key];
      if (typeof value === "string") return value;
      if (value && typeof value === "object") {
        const message = (value as Record<string, unknown>).message;
        if (typeof message === "string") return message;
      }
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0] as Record<string, unknown>;
        if (typeof first?.msg === "string") return first.msg;
      }
    }
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return response.statusText || "request failed";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
