/**
 * Backend selection. Explicit `JEV_BACKEND` wins; otherwise the first
 * credential found decides: TypeSafe direct → OpenRouter → Vercel AI
 * Gateway. `mock` must be asked for explicitly — it never engages on its
 * own, so a missing key is a loud, named error instead of silent fakery.
 */
import type { JevBackend } from "./types.js";
/** The backends that ship with jev-use. */
export type BackendName = "typesafe" | "openrouter" | "vercel" | "mock";
/** A backend plus the story of how it was chosen. */
export interface ResolvedBackend {
    backend: JevBackend;
    /** How the choice was made, for `jev-use doctor` and startup logs. */
    via: string;
}
/**
 * Resolve the backend to judge with. `name` (or `JEV_BACKEND`) forces one;
 * without it, the first credential present in `env` wins. Throws a named
 * error when nothing is configured — silence here would look like Jev
 * answering when nothing did.
 */
export declare function createBackend(name?: string, env?: Record<string, string | undefined>): ResolvedBackend;
/**
 * Backend resolution for the long-lived `serve` path, which must start even
 * when nothing is configured: a missing credential becomes a backend that
 * answers every call with that same named error, so the harness shows the
 * server connected and the agent is told what to set.
 */
export declare function createServerBackend(name?: string, env?: Record<string, string | undefined>): ResolvedBackend;
