/**
 * Wire-format tests: each backend must emit the exact request shape its
 * provider documents and parse the documented response. Fixtures follow
 * the official OpenRouter decisions example and the typesafe-sdk-js /
 * @ai-sdk/gateway source (verified 2026-09).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend } from "../src/backends/index.js";
import { OpenRouterBackend } from "../src/backends/openrouter.js";
import { TypeSafeBackend } from "../src/backends/typesafe.js";
import { BackendError } from "../src/backends/types.js";
import { VercelBackend } from "../src/backends/vercel.js";
import type { Question } from "../src/protocol.js";

type Q = Question & { id: string };

const questions: Q[] = [
  {
    id: "is_bug",
    type: "noul",
    question: "Is the customer reporting a software defect?",
    criteria: {
      true: "The customer describes broken behavior.",
      false: "The customer is asking a question.",
    },
  },
  {
    id: "team",
    type: "choice",
    question: "Which team should own this ticket?",
    options: { frontend: "Rendering issues", payments: "Checkout issues" },
  },
  {
    id: "urgency",
    type: "score",
    question: "How urgent is this ticket?",
    levels: ["Can wait", "This week", "Blocking revenue"],
  },
];

const nativeAnswers = {
  is_bug: { type: "noul", noul: 0.96 },
  team: {
    type: "choice",
    choice: "payments",
    confidence: 0.75,
    probabilities: { frontend: 0.16, payments: 0.84 },
  },
  urgency: {
    type: "score",
    score: 1.99,
    confidence: 0.99,
    legend: { "0": "Can wait", "1": "This week", "2": "Blocking revenue" },
    probabilities: { "0": 0, "1": 0.01, "2": 0.99 },
  },
};

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const responses: { status: number; body: unknown; headers: Record<string, string> }[] = [
    { status, body, headers },
  ];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift() ?? responses[0] ?? { status, body, headers };
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json", ...r.headers },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, queue: responses };
}

afterEach(() => vi.unstubAllGlobals());

describe("TypeSafeBackend", () => {
  it("posts the native body to /v1/systemone and parses the answer map", async () => {
    const { calls } = mockFetchOnce(200, {
      model: "jev-1.13",
      answers: nativeAnswers,
      usage: { input_tokens: 476, output_tokens: 70 },
    });
    const backend = new TypeSafeBackend({ apiKey: "sk-test" });
    const res = await backend.judge({ state: { ticket: "blank checkout" }, questions });

    expect(calls[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({
      model: "jev-latest",
      state: { ticket: "blank checkout" },
      questions: {
        is_bug: {
          type: "noul",
          instructions: "Is the customer reporting a software defect?",
          criteria: {
            true: "The customer describes broken behavior.",
            false: "The customer is asking a question.",
          },
        },
        team: {
          type: "choice",
          instructions: "Which team should own this ticket?",
          criteria: { frontend: "Rendering issues", payments: "Checkout issues" },
        },
        urgency: {
          type: "score",
          instructions: "How urgent is this ticket?",
          criteria: ["Can wait", "This week", "Blocking revenue"],
        },
      },
    });

    expect(res.answers).toEqual([
      { answer: 0.96 },
      {
        answer: "payments",
        confidence: 0.75,
        distribution: { frontend: 0.16, payments: 0.84 },
      },
      {
        answer: 1.99,
        confidence: 0.99,
        distribution: { "0": 0, "1": 0.01, "2": 0.99 },
        legend: { "0": "Can wait", "1": "This week", "2": "Blocking revenue" },
      },
    ]);
    expect(res.usage).toEqual({ inputTokens: 476, outputTokens: 70 });
  });

  it("turns label-only options into label->label criteria", async () => {
    const { calls } = mockFetchOnce(200, {
      answers: { q0: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } },
    });
    const backend = new TypeSafeBackend({ apiKey: "sk-test" });
    await backend.judge({
      state: "s",
      questions: [{ id: "q0", type: "choice", question: "pick", options: ["a", "b"] }],
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.questions.q0.criteria).toEqual({ a: "a", b: "b" });
  });

  it("throws a named BackendError on a 4xx without retrying", async () => {
    const { calls } = mockFetchOnce(401, { error: { message: "invalid api key" } });
    const backend = new TypeSafeBackend({ apiKey: "bad" });
    await expect(
      backend.judge({ state: "s", questions: [questions[0]] }),
    ).rejects.toThrow(/401.*invalid api key/);
    expect(calls).toHaveLength(1);
  });

  it("retries a 429 honoring retry-after-ms", async () => {
    const { calls, queue } = mockFetchOnce(429, { error: "slow down" }, { "retry-after-ms": "1" });
    queue.push({ status: 200, body: { answers: { is_bug: { type: "noul", noul: 0.9 } } }, headers: {} });
    const backend = new TypeSafeBackend({ apiKey: "sk-test" });
    const res = await backend.judge({ state: "s", questions: [questions[0]] });
    expect(calls).toHaveLength(2);
    expect(res.answers[0].answer).toBe(0.9);
  });

  /**
   * No noul answer observed on any provider carries a confidence — the head is
   * reported for choice/score only, which is why a `check` verdict always reads
   * `confidenceFrom: "estimated"`. The parser still relays one if it appears,
   * rather than silently estimating over the provider's own number.
   */
  it("relays a noul confidence if the provider ever sends one", async () => {
    mockFetchOnce(200, { answers: { is_bug: { type: "noul", noul: 0.96, confidence: 0.9 } } });
    const backend = new TypeSafeBackend({ apiKey: "sk-test" });
    const res = await backend.judge({ state: "s", questions: [questions[0]] });
    expect(res.answers[0]).toEqual({ answer: 0.96, confidence: 0.9 });
  });

  it("errors when the response is missing an answer", async () => {
    mockFetchOnce(200, { answers: {} });
    const backend = new TypeSafeBackend({ apiKey: "sk-test" });
    await expect(
      backend.judge({ state: "s", questions: [questions[0]] }),
    ).rejects.toThrow(BackendError);
  });
});

describe("OpenRouterBackend", () => {
  it("posts the native body to /api/alpha/decisions with the OpenRouter slug", async () => {
    const { calls } = mockFetchOnce(200, {
      model: "typesafe/jev-1.13-20260917",
      answers: nativeAnswers,
      usage: { input_tokens: 476, output_tokens: 70, cost: 0.00002 },
    });
    const backend = new OpenRouterBackend({ apiKey: "or-test" });
    const res = await backend.judge({ state: "ticket text", questions });

    expect(calls[0].url).toBe("https://openrouter.ai/api/alpha/decisions");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("typesafe/jev-latest");
    // instructions must be present on every question (OpenRouter requires it)
    for (const q of Object.values(body.questions) as { instructions?: string }[]) {
      expect(q.instructions).toBeTruthy();
    }
    expect(res.model).toBe("typesafe/jev-1.13-20260917");
  });
});

/**
 * Recorded verbatim from https://ai-gateway.vercel.sh/v4/ai/evaluation-model on
 * 2026-09-19 (generation gen_01M2XRRFYM5NKNPGHCDZ2NH1V0), for exactly the three
 * questions above. Note the two things the dialect does out-of-band: Jev's
 * confidence head arrives under `providerMetadata.typesafe.confidence`, keyed by
 * question id — and the `boolean` answer is simply absent from that map.
 */
const recordedGatewayResponse = {
  answers: {
    is_bug: { type: "boolean", probability: 0.97 },
    team: { type: "choice", choice: "payments", probabilities: { frontend: 0.04, payments: 0.96 } },
    urgency: { type: "score", score: 2, probabilities: { "0": 0, "1": 0, "2": 1 } },
  },
  rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
  usage: { inputTokens: 413, outputTokens: 63 },
  warnings: [],
  providerMetadata: {
    typesafe: { confidence: { team: 0.92, urgency: 1 } },
    gateway: {
      cost: "0",
      marketCost: "0.000017346",
      generationId: "gen_01M2XRRFYM5NKNPGHCDZ2NH1V0",
    },
  },
};

describe("VercelBackend", () => {
  it("speaks the gateway dialect: model header, boolean type, probability field", async () => {
    const { calls } = mockFetchOnce(200, {
      answers: {
        is_bug: { type: "boolean", probability: 0.96 },
        team: { type: "choice", choice: "payments", probabilities: { frontend: 0.16, payments: 0.84 } },
        urgency: { type: "score", score: 1.99, probabilities: { "0": 0, "1": 0.01, "2": 0.99 } },
      },
      usage: { inputTokens: 476, outputTokens: 0 },
    });
    const backend = new VercelBackend({ apiKey: "vc-test" });
    const res = await backend.judge({ state: "ticket text", questions });

    expect(calls[0].url).toBe("https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["ai-model-id"]).toBe("typesafe-ai/jev");
    expect(headers["ai-evaluation-model-specification-version"]).toBe("4");
    expect(headers["ai-gateway-protocol-version"]).toBe("0.0.1");

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBeUndefined(); // model travels in the header
    expect(body.questions.is_bug.type).toBe("boolean");
    expect(body.questions.urgency.criteria).toEqual(["Can wait", "This week", "Blocking revenue"]);

    // A response with no providerMetadata at all: nothing is reported, so every
    // answer comes back for the engine to estimate from its distribution.
    expect(res.answers[0]).toEqual({ answer: 0.96 });
    expect(res.answers[1]).toEqual({
      answer: "payments",
      distribution: { frontend: 0.16, payments: 0.84 },
      confidence: undefined,
    });
    expect(res.usage).toEqual({ inputTokens: 476, outputTokens: 0 });
  });

  it("reads Jev's confidence head out of providerMetadata, per question id", async () => {
    mockFetchOnce(200, recordedGatewayResponse);
    const backend = new VercelBackend({ apiKey: "vc-test" });
    const res = await backend.judge({ state: "ticket text", questions });

    // boolean: no entry in the confidence map, so no reported confidence
    expect(res.answers[0]).toEqual({ answer: 0.97 });
    // choice and score: the head, keyed by the question's own id
    expect(res.answers[1]).toEqual({
      answer: "payments",
      distribution: { frontend: 0.04, payments: 0.96 },
      confidence: 0.92,
    });
    expect(res.answers[2]).toEqual({
      answer: 2,
      distribution: { "0": 0, "1": 0, "2": 1 },
      confidence: 1,
    });
  });

  it("ignores a confidence entry that is not a number", async () => {
    mockFetchOnce(200, {
      ...recordedGatewayResponse,
      providerMetadata: { typesafe: { confidence: { team: null } } },
    });
    const backend = new VercelBackend({ apiKey: "vc-test" });
    const res = await backend.judge({ state: "ticket text", questions });
    expect(res.answers[1].confidence).toBeUndefined();
  });
});

describe("extra headers", () => {
  it("sends options.headers on the wire alongside the backend's own auth", async () => {
    const { calls } = mockFetchOnce(200, {
      model: "jev-1.13",
      answers: nativeAnswers,
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const backend = new TypeSafeBackend({
      apiKey: "sk-test",
      headers: { "x-tenant-id": "acme" },
    });
    await backend.judge({ state: "state", questions });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("acme");
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  it("applies options.headers to every retry", async () => {
    const { calls, queue } = mockFetchOnce(200, {
      model: "jev-1.13",
      answers: nativeAnswers,
    });
    queue.unshift({ status: 500, body: { error: "boom" }, headers: {} });
    const backend = new TypeSafeBackend({
      apiKey: "sk-test",
      headers: { "x-tenant-id": "acme" },
    });
    await backend.judge({ state: "state", questions });

    expect(calls.length).toBe(2);
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers["x-tenant-id"]).toBe("acme");
    }
  });

  it("keeps the backend's own Authorization when an extra header collides", async () => {
    const { calls } = mockFetchOnce(200, {
      model: "jev-1.13",
      answers: nativeAnswers,
    });
    const backend = new TypeSafeBackend({
      apiKey: "sk-test",
      headers: { Authorization: "Bearer spoofed" },
    });
    await backend.judge({ state: "state", questions });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  it("createBackend passes JEV_EXTRA_HEADERS through to the wire", async () => {
    const { calls } = mockFetchOnce(200, {
      model: "jev-1.13",
      answers: nativeAnswers,
    });
    const { backend } = createBackend(undefined, {
      TYPESAFE_API_KEY: "sk-test",
      JEV_EXTRA_HEADERS: '{"x-tenant-id":"acme"}',
    });
    await backend.judge({ state: "state", questions });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("acme");
  });

  it("rejects a JEV_EXTRA_HEADERS that is not valid JSON", () => {
    expect(() =>
      createBackend(undefined, {
        TYPESAFE_API_KEY: "k",
        JEV_EXTRA_HEADERS: "{not json",
      }),
    ).toThrow(/JEV_EXTRA_HEADERS must be a JSON object/);
  });

  it("rejects a JEV_EXTRA_HEADERS with non-string values", () => {
    expect(() =>
      createBackend(undefined, {
        TYPESAFE_API_KEY: "k",
        JEV_EXTRA_HEADERS: '{"x-tenant-id":42}',
      }),
    ).toThrow(/JEV_EXTRA_HEADERS must be a JSON object of string values/);
  });
});
