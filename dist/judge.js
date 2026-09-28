/**
 * The engine: screen the questions, call the backend, hand back what Jev is
 * unsure about — producing verdicts that always come back in the caller's
 * question order, with escalations in-band. These functions must never throw
 * for reachable-world reasons: an unreachable backend degrades to
 * escalate-everything.
 *
 * Callers writing code use the `Jev` client, which wraps this; the wire
 * surfaces (MCP tools, pi tools, `jev-use judge`) call it directly because
 * the ordered `JudgeResult` is exactly their payload.
 */
import { certainty, escalateIfUnsure, margin, screenQuestions, } from "./dispatch.js";
import { serializeState, } from "./protocol.js";
import { BackendError } from "./backends/types.js";
import { redactSecrets } from "./redact.js";
/** Answer one batch of questions about one state. */
export async function judge(backend, request) {
    const screened = screenQuestions(request.state, request.questions);
    const verdicts = new Array(request.questions.length);
    for (const handedBack of screened.handedBack) {
        verdicts[handedBack.index] = handedBack.verdict;
    }
    let model = request.model;
    let latencyMs;
    let usage;
    if (screened.sendable.length > 0) {
        try {
            const response = await backend.judge({
                state: request.state,
                questions: screened.sendable.map((sendable) => sendable.question),
                model: request.model,
            });
            model = response.model ?? model;
            latencyMs = response.latencyMs;
            usage = response.usage;
            screened.sendable.forEach(({ index, question }, position) => {
                const raw = response.answers[position];
                const verdict = raw
                    ? toVerdict(question, raw)
                    : missingAnswerVerdict(question, backend.name);
                // No explicit threshold means no single number: each verdict is judged
                // against the one for its own confidence source.
                verdicts[index] = escalateIfUnsure(verdict, request.confidenceThreshold);
            });
        }
        catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
            for (const { index, question } of screened.sendable) {
                verdicts[index] = {
                    id: question.id,
                    type: question.type,
                    answer: null,
                    confidence: 0,
                    escalate: true,
                    reason: "unreachable",
                    hint: `Jev backend failed (${message}); answer this yourself.`,
                };
            }
        }
    }
    return {
        verdicts,
        escalated: verdicts.some((verdict) => verdict.escalate),
        backend: backend.name,
        model,
        latencyMs,
        usage,
    };
}
/**
 * Shape one backend answer as a verdict, filling in confidence per primitive —
 * and, with it, where that confidence came from. Any provider-reported number
 * wins; otherwise the answer's own distribution is the only signal there is.
 */
function toVerdict(question, raw) {
    switch (question.type) {
        case "noul": {
            const probability = clamp01(Number(raw.answer));
            return {
                id: question.id,
                type: question.type,
                answer: probability,
                ...confidenceOf(raw, certainty(probability)),
                escalate: false,
            };
        }
        case "choice": {
            const distribution = raw.distribution;
            return {
                id: question.id,
                type: question.type,
                answer: String(raw.answer),
                distribution,
                ...confidenceOf(raw, estimateFrom(distribution)),
                escalate: false,
            };
        }
        case "score": {
            const distribution = raw.distribution;
            return {
                id: question.id,
                type: question.type,
                answer: Number(raw.answer),
                distribution,
                legend: raw.legend ??
                    Object.fromEntries((question.levels ?? []).map((level, index) => [String(index), level])),
                ...confidenceOf(raw, estimateFrom(distribution)),
                escalate: false,
            };
        }
    }
}
/**
 * The confidence a verdict carries and its provenance: what the provider
 * reported, else what this primitive can estimate from its own distribution.
 */
function confidenceOf(raw, estimated) {
    return raw.confidence !== undefined
        ? { confidence: raw.confidence, confidenceFrom: "reported" }
        : { confidence: estimated, confidenceFrom: "estimated" };
}
/** Estimate from a choice/score distribution: its own top-vs-runner-up margin. */
function estimateFrom(distribution) {
    return distribution ? margin(distribution) : 0;
}
/** A backend answered the batch but skipped this question — treat it as a failure. */
function missingAnswerVerdict(question, backend) {
    return {
        id: question.id,
        type: question.type,
        answer: null,
        confidence: 0,
        escalate: true,
        reason: "unreachable",
        hint: `Backend "${backend}" returned no answer for this question.`,
    };
}
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(1, Math.max(0, value));
}
/**
 * Gate an agent action: sugar over a single allow/deny choice question.
 *
 * The action is the one part of the judged state nobody wrote by hand — the
 * hook hands over whatever the agent proposed — so its credentials are
 * redacted before it leaves the machine (`redact.ts`). The state around it is
 * sent as given.
 */
export async function gate(backend, request) {
    const { tool, input, description } = request.action;
    const action = [
        `Tool: ${tool}`,
        description ? `Description: ${redactSecrets(description)}` : null,
        `Input: ${redactSecrets(typeof input === "string" ? input : JSON.stringify(input))}`,
    ]
        .filter(Boolean)
        .join("\n");
    const state = `${serializeState(request.state)}\n\n--- proposed action ---\n${action}`;
    const result = await judge(backend, {
        state,
        questions: [
            {
                id: "gate",
                type: "choice",
                question: "Should the agent be allowed to run this proposed action right now?",
                options: {
                    allow: "The action is safe, reversible or expected, and consistent with the state.",
                    deny: "The action is destructive, off-task, touches things the state says to protect, or looks like a mistake.",
                },
            },
        ],
        confidenceThreshold: request.confidenceThreshold,
        model: request.model,
    });
    const verdict = result.verdicts[0];
    const decision = verdict.escalate
        ? "escalate"
        : verdict.answer === "deny"
            ? "deny"
            : "allow";
    return {
        decision,
        confidence: verdict.confidence,
        confidenceFrom: verdict.confidenceFrom,
        reason: verdict.reason,
        distribution: verdict.distribution,
        hint: verdict.hint,
        backend: result.backend,
        latencyMs: result.latencyMs,
        usage: result.usage,
    };
}
