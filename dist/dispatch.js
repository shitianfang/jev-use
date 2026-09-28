/**
 * The dispatcher: decides, per question, whether the question goes to Jev at
 * all (before the call), and whether Jev's answer is trustworthy enough to act
 * on (after it). Deterministic and instant — no model call involved.
 *
 * `route` at the bottom is the same decision one step earlier, for callers
 * driving their own loop: it says whether a step is even Jev-shaped before a
 * question is written.
 */
import { confidenceThresholdFor, DEFAULT_MAX_STATE_TOKENS, defaultQuestionId, estimateTokens, optionEntries, } from "./protocol.js";
function handBack(question, index, reason, hint) {
    return {
        index,
        verdict: {
            id: question.id,
            type: question.type,
            answer: null,
            confidence: 0,
            escalate: true,
            reason,
            hint,
        },
    };
}
/**
 * Structural checks that need no model: is each question expressible in
 * Jev's primitives, and does the state fit?
 */
export function screenQuestions(state, questions, limits = {}) {
    const identified = questions.map((question, index) => ({
        ...question,
        id: question.id ?? defaultQuestionId(index),
    }));
    const maxStateTokens = limits.maxStateTokens ?? DEFAULT_MAX_STATE_TOKENS;
    if (estimateTokens(state) > maxStateTokens) {
        return {
            sendable: [],
            handedBack: identified.map((question, index) => handBack(question, index, "oversized", `State exceeds ~${maxStateTokens} tokens; shrink it (summarize, drop stale entries) or take the question over yourself.`)),
            oversized: true,
        };
    }
    const sendable = [];
    const handedBack = [];
    const seenIds = new Set();
    identified.forEach((question, index) => {
        if (seenIds.has(question.id)) {
            handedBack.push(handBack(question, index, "open_ended", `Duplicate question id "${question.id}" — ids key the batch and must be unique.`));
            return;
        }
        seenIds.add(question.id);
        const problem = whyUnaskable(question);
        if (problem) {
            handedBack.push(handBack(question, index, "open_ended", problem));
        }
        else {
            sendable.push({ index, question });
        }
    });
    return { sendable, handedBack };
}
/** Returns a human-readable reason when a question cannot reach Jev. */
export function whyUnaskable(question) {
    if (!question.question || !question.question.trim()) {
        return "Empty question text.";
    }
    switch (question.type) {
        case "noul": {
            const criteria = question.criteria;
            if (criteria && (!criteria.true?.trim() || !criteria.false?.trim())) {
                return "noul criteria needs BOTH `true` and `false` meanings (or neither).";
            }
            return null;
        }
        case "choice": {
            if (!question.options) {
                return "A choice question needs >= 2 enumerated options; if the options cannot be enumerated, this step is open-ended — take it over.";
            }
            const labels = optionEntries(question.options).map(([label]) => label);
            if (labels.length < 2) {
                return "A choice question needs >= 2 enumerated options.";
            }
            if (labels.some((label) => !label.trim())) {
                return "Choice option labels must be non-empty.";
            }
            if (new Set(labels).size !== labels.length) {
                return "Choice options must be distinct.";
            }
            return null;
        }
        case "score": {
            if (!question.levels || question.levels.length < 2) {
                return "A score question needs >= 2 ORDERED level descriptions (`levels`); the answer is an index into them. An unbounded quantity is not scorable — take it over.";
            }
            if (question.levels.some((level) => !level.trim())) {
                return "Score levels must be non-empty descriptions.";
            }
            return null;
        }
        default:
            return `Unknown question type "${question.type}" — only noul | choice | score exist.`;
    }
}
/**
 * After the call: given a verdict Jev produced, decide whether the LLM should
 * take over anyway because the answer is too uncertain to act on.
 *
 * With no `override`, each verdict is judged against the threshold for its own
 * confidence source — a reported head and an estimate off the distribution are
 * different quantities, so one number cannot serve both. An override applies to
 * every verdict as written, whatever its source: the caller asked for a number.
 */
export function escalateIfUnsure(verdict, override) {
    if (verdict.escalate)
        return verdict; // already handed back upstream
    // A verdict that reached this point came from a backend answer, so it carries
    // a source; the fallback is the conservative one.
    const source = verdict.confidenceFrom ?? "estimated";
    const threshold = override ?? confidenceThresholdFor(source);
    if (verdict.confidence >= threshold)
        return verdict;
    return {
        ...verdict,
        escalate: true,
        reason: "unsure",
        hint: `Jev answered (${formatAnswer(verdict)}) at ${source} confidence ` +
            `${verdict.confidence.toFixed(2)} < ${threshold}. Treat the answer as a ` +
            `prior, not a decision — reason it out yourself.`,
    };
}
function formatAnswer(verdict) {
    if (verdict.answer === null)
        return "null";
    return typeof verdict.answer === "number"
        ? verdict.answer.toFixed(3)
        : String(verdict.answer);
}
/** Certainty of a noul probability: 0 at a coin flip, 1 at either extreme. */
export function certainty(probability) {
    return round4(Math.min(1, Math.max(0, Math.abs(probability - 0.5) * 2)));
}
/** Confidence values are quantities like 0.93 - 0.07; keep them readable. */
function round4(value) {
    return Math.round(value * 1e4) / 1e4;
}
/**
 * Estimated confidence for a distribution when the provider reports none: the
 * margin between the winner and the runner-up. On a two-option question this
 * is exactly what Jev's own confidence head returns (measured: 168 live
 * answers, |difference| ≤ 0.01 = the wire's 2-decimal rounding); on three or
 * more it reads a median 0.05 lower, which is why the estimated threshold sits
 * below the reported one.
 *
 * Reading the top probability instead (rescaled to `(p_top − 1/n)/(1 − 1/n)`)
 * would match the reported head exactly for `choice` — but not for `score`
 * past two levels, where the head can sit ABOVE `p_top`. That is why this stays
 * a second quantity with its own threshold (bench/RESULTS.md).
 */
export function margin(distribution) {
    const sorted = Object.values(distribution).sort((a, b) => b - a);
    if (sorted.length === 0)
        return 0;
    if (sorted.length === 1)
        return round4(sorted[0]);
    return round4(Math.min(1, Math.max(0, sorted[0] - sorted[1])));
}
/**
 * Route one step before spending anything — no client, no key, no call.
 * Content to write is the LLM's (`writing`); so is a judgment whose options
 * cannot be enumerated (`open_ended`). Everything else is a typed question Jev
 * can answer, so ask it with `check` / `pick` / `rate`.
 *
 * ```ts
 * route({ producesContent: false, enumerable: true });   // { to: "jev" }
 * route({ producesContent: true, enumerable: true });    // { to: "llm", reason: "writing" }
 * ```
 *
 * This is the pre-call half of the same handoff `escalate` carries after a
 * call: same reasons, same vocabulary, decided deterministically.
 */
export function route(step) {
    if (step.producesContent)
        return { to: "llm", reason: "writing" };
    if (!step.enumerable)
        return { to: "llm", reason: "open_ended" };
    return { to: "jev" };
}
