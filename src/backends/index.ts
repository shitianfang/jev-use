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
export function createBackend(
  name?: string,
  env: Record<string, string | undefined> = process.env,
): ResolvedBackend {
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
      throw new Error(
        `Unknown backend "${requested}". Valid: typesafe | openrouter | vercel | mock.`,
      );
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
  throw new Error(
    "No Jev credentials found. Set one of TYPESAFE_API_KEY (direct), " +
      "OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY (Vercel AI Gateway) — " +
      "or run with JEV_BACKEND=mock for a keyless dry run.",
  );
}

/**
 * Parse `JEV_EXTRA_HEADERS` — a JSON object whose values are all strings —
 * into the `headers` every remote backend sends. Lets self-hosted gateways
 * that demand more than a Bearer token (attribution headers, tenant IDs,
 * proxy auth) work with stock backends.
 */
function extraHeaders(env: Record<string, string | undefined>):
  | Record<string, string>
  | undefined {
  const raw = env.JEV_EXTRA_HEADERS;
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JEV_EXTRA_HEADERS must be a JSON object.");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== "string")
  ) {
    throw new Error("JEV_EXTRA_HEADERS must be a JSON object of string values.");
  }
  return parsed as Record<string, string>;
}

function typesafe(env: Record<string, string | undefined>): TypeSafeBackend {
  const apiKey = env.TYPESAFE_API_KEY ?? env.TYPESAFE_AI_API_KEY;
  if (!apiKey) throw new Error("JEV_BACKEND=typesafe needs TYPESAFE_API_KEY.");
  return new TypeSafeBackend({
    apiKey,
    baseUrl: env.TYPESAFE_BASE_URL,
    defaultModel: env.JEV_MODEL ?? env.TYPESAFE_DEFAULT_MODEL,
    headers: extraHeaders(env),
  });
}

function openrouter(env: Record<string, string | undefined>): OpenRouterBackend {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("JEV_BACKEND=openrouter needs OPENROUTER_API_KEY.");
  return new OpenRouterBackend({
    apiKey,
    baseUrl: env.OPENROUTER_BASE_URL,
    defaultModel: env.JEV_MODEL,
    headers: extraHeaders(env),
  });
}

function vercel(env: Record<string, string | undefined>): VercelBackend {
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("JEV_BACKEND=vercel needs AI_GATEWAY_API_KEY.");
  return new VercelBackend({
    apiKey,
    baseUrl: env.AI_GATEWAY_BASE_URL,
    defaultModel: env.JEV_MODEL,
    headers: extraHeaders(env),
  });
}

/**
 * Backend resolution for the long-lived `serve` path, which must start even
 * when nothing is configured: a missing credential becomes a backend that
 * answers every call with that same named error, so the harness shows the
 * server connected and the agent is told what to set.
 */
export function createServerBackend(
  name?: string,
  env: Record<string, string | undefined> = process.env,
): ResolvedBackend {
  try {
    return createBackend(name, env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { backend: new UnconfiguredBackend(reason), via: `unconfigured — ${reason}` };
  }
}
