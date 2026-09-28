/**
 * Backend selection. Explicit `JEV_BACKEND` wins; otherwise the first
 * credential found decides: TypeSafe direct → OpenRouter → Vercel AI
 * Gateway. `mock` must be asked for explicitly — it never engages on its
 * own, so a missing key is a loud, named error instead of silent fakery.
 */
import { MockBackend } from "./mock.js";
import { OpenRouterBackend } from "./openrouter.js";
import { TypeSafeBackend } from "./typesafe.js";
import { UnconfiguredBackend } from "./unconfigured.js";
import { VercelBackend } from "./vercel.js";
/**
 * Resolve the backend to judge with. `name` (or `JEV_BACKEND`) forces one;
 * without it, the first credential present in `env` wins. Throws a named
 * error when nothing is configured — silence here would look like Jev
 * answering when nothing did.
 */
export function createBackend(name, env = process.env) {
    const requested = (name ?? env.JEV_BACKEND)?.toLowerCase();
    switch (requested) {
        case undefined:
        case "":
        case "auto":
            break;
        case "typesafe":
            return { backend: typesafe(env), via: "explicit: typesafe" };
        case "openrouter":
            return { backend: openrouter(env), via: "explicit: openrouter" };
        case "vercel":
            return { backend: vercel(env), via: "explicit: vercel" };
        case "mock":
            return {
                backend: new MockBackend(),
                via: "explicit: mock (no real Jev calls)",
            };
        default:
            throw new Error(`Unknown backend "${requested}". Valid: typesafe | openrouter | vercel | mock.`);
    }
    if (env.TYPESAFE_API_KEY || env.TYPESAFE_AI_API_KEY) {
        return { backend: typesafe(env), via: "auto: TYPESAFE_API_KEY found" };
    }
    if (env.OPENROUTER_API_KEY) {
        return { backend: openrouter(env), via: "auto: OPENROUTER_API_KEY found" };
    }
    if (env.AI_GATEWAY_API_KEY) {
        return { backend: vercel(env), via: "auto: AI_GATEWAY_API_KEY found" };
    }
    throw new Error("No Jev credentials found. Set one of TYPESAFE_API_KEY (direct), " +
        "OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY (Vercel AI Gateway) — " +
        "or run with JEV_BACKEND=mock for a keyless dry run.");
}
function typesafe(env) {
    const apiKey = env.TYPESAFE_API_KEY ?? env.TYPESAFE_AI_API_KEY;
    if (!apiKey)
        throw new Error("JEV_BACKEND=typesafe needs TYPESAFE_API_KEY.");
    return new TypeSafeBackend({
        apiKey,
        baseUrl: env.TYPESAFE_BASE_URL,
        defaultModel: env.JEV_MODEL ?? env.TYPESAFE_DEFAULT_MODEL,
    });
}
function openrouter(env) {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey)
        throw new Error("JEV_BACKEND=openrouter needs OPENROUTER_API_KEY.");
    return new OpenRouterBackend({
        apiKey,
        baseUrl: env.OPENROUTER_BASE_URL,
        defaultModel: env.JEV_MODEL,
    });
}
function vercel(env) {
    const apiKey = env.AI_GATEWAY_API_KEY;
    if (!apiKey)
        throw new Error("JEV_BACKEND=vercel needs AI_GATEWAY_API_KEY.");
    return new VercelBackend({
        apiKey,
        baseUrl: env.AI_GATEWAY_BASE_URL,
        defaultModel: env.JEV_MODEL,
    });
}
/**
 * Backend resolution for the long-lived `serve` path, which must start even
 * when nothing is configured: a missing credential becomes a backend that
 * answers every call with that same named error, so the harness shows the
 * server connected and the agent is told what to set.
 */
export function createServerBackend(name, env = process.env) {
    try {
        return createBackend(name, env);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { backend: new UnconfiguredBackend(reason), via: `unconfigured — ${reason}` };
    }
}
