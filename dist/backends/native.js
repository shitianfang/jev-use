/**
 * Jev's native wire dialect, shared verbatim by the TypeSafe direct API
 * and OpenRouter's /api/alpha/decisions: questions are a map keyed by
 * answer name; choice options are label → description; score criteria is
 * an ordered list indexed from 0.
 */
import { optionEntries } from "../protocol.js";
import { BackendError } from "./types.js";
/** Translate one question into the native dialect. */
export function toNativeQuestion(question) {
    switch (question.type) {
        case "noul":
            return {
                type: "noul",
                instructions: question.question,
                ...(question.criteria ? { criteria: question.criteria } : {}),
            };
        case "choice":
            return {
                type: "choice",
                instructions: question.question,
                // Label-only options get the label as its own description.
                criteria: Object.fromEntries(optionEntries(question.options ?? []).map(([label, meaning]) => [
                    label,
                    meaning || label,
                ])),
            };
        case "score":
            return {
                type: "score",
                instructions: question.question,
                criteria: question.levels ?? [],
            };
    }
}
/** Build the whole request body: model, state, and the questions by id. */
export function toNativeBody(state, questions, model) {
    return {
        model,
        state,
        questions: Object.fromEntries(questions.map((question) => [question.id, toNativeQuestion(question)])),
    };
}
/**
 * Read the provider's answer map back into raw answers, in question order.
 * Anything missing or mistyped is a `BackendError` — a silently dropped
 * answer would read as a low-confidence judgment.
 */
export function parseNativeAnswers(backend, answers, questions) {
    if (!answers || typeof answers !== "object") {
        throw new BackendError(backend, "response has no answers object");
    }
    const byId = answers;
    return questions.map((question) => {
        const answer = byId[question.id];
        if (!answer) {
            throw new BackendError(backend, `response missing answer for question "${question.id}"`);
        }
        switch (question.type) {
            case "noul":
                // No noul answer observed so far carries a confidence — Jev's head is
                // reported for choice/score only. Pass one through if it ever appears
                // rather than silently estimating over it.
                return {
                    answer: numberOrThrow(backend, question.id, answer.noul),
                    confidence: answer.confidence,
                };
            case "choice":
                return {
                    answer: stringOrThrow(backend, question.id, answer.choice),
                    confidence: answer.confidence,
                    distribution: answer.probabilities,
                };
            case "score":
                return {
                    answer: numberOrThrow(backend, question.id, answer.score),
                    confidence: answer.confidence,
                    distribution: answer.probabilities,
                    legend: answer.legend,
                };
        }
    });
}
function numberOrThrow(backend, id, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new BackendError(backend, `answer "${id}" has no numeric value`);
    }
    return value;
}
function stringOrThrow(backend, id, value) {
    if (typeof value !== "string" || !value) {
        throw new BackendError(backend, `answer "${id}" has no choice value`);
    }
    return value;
}
