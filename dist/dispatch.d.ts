/**
 * The dispatcher: decides, per question, whether the question goes to Jev at
 * all (before the call), and whether Jev's answer is trustworthy enough to act
 * on (after it). Deterministic and instant — no model call involved.
 *
 * `route` at the bottom is the same decision one step earlier, for callers
 * driving their own loop: it says whether a step is even Jev-shaped before a
 * question is written.
 */
import { type EscalationReason, type Question, type State, type Verdict } from "./protocol.js";
/** Caps the dispatcher enforces around a call. */
export interface ScreenLimits {
    /** Hand back the batch when the serialized state exceeds this. Default 30k. */
    maxStateTokens?: number;
}
/** One question handed back before the call, with the verdict that says why. */
export interface HandedBackQuestion {
    index: number;
    verdict: Verdict;
}
/** What screening decided about one batch. */
export interface ScreenedQuestions {
    /** Questions that may be sent to Jev (ids resolved), with original indices. */
    sendable: {
        index: number;
        question: Question & {
            id: string;
        };
    }[];
    /** Questions handed back before the call, already shaped as verdicts. */
    handedBack: HandedBackQuestion[];
    /** Set when the state itself is too large — hands back the whole batch. */
    oversized?: boolean;
}
/**
 * Structural checks that need no model: is each question expressible in
 * Jev's primitives, and does the state fit?
 */
export declare function screenQuestions(state: State, questions: Question[], limits?: ScreenLimits): ScreenedQuestions;
/** Returns a human-readable reason when a question cannot reach Jev. */
export declare function whyUnaskable(question: Question): string | null;
/**
 * After the call: given a verdict Jev produced, decide whether the LLM should
 * take over anyway because the answer is too uncertain to act on.
 *
 * With no `override`, each verdict is judged against the threshold for its own
 * confidence source — a reported head and an estimate off the distribution are
 * different quantities, so one number cannot serve both. An override applies to
 * every verdict as written, whatever its source: the caller asked for a number.
 */
export declare function escalateIfUnsure(verdict: Verdict, override?: number): Verdict;
/** Certainty of a noul probability: 0 at a coin flip, 1 at either extreme. */
export declare function certainty(probability: number): number;
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
export declare function margin(distribution: Record<string, number>): number;
/** One step of a loop, described in the two facts that decide who takes it. */
export interface Step {
    /** Must the step produce new content (text, code, free-form args)? */
    producesContent: boolean;
    /** Can the possible actions/answers be enumerated up front? */
    enumerable: boolean;
}
/** Who a step belongs to, and — when it is the LLM's — which boundary says so. */
export interface StepRoute {
    /** "jev" = a typed question can decide it; "llm" = it is the model's to do. */
    to: "jev" | "llm";
    /** Set when `to` is "llm": the handoff reason, decided before any call. */
    reason?: Extract<EscalationReason, "writing" | "open_ended">;
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
export declare function route(step: Step): StepRoute;
