/**
 * The jev-use handoff protocol.
 *
 * Jev (TypeSafe AI's System One model) answers typed questions about a state
 * in one forward pass — it never generates text. An LLM and Jev cooperate by
 * handing off:
 *
 *   LLM ──(state + typed questions)──▶ Jev        fast, cheap, calibrated
 *   Jev ──(verdict, escalate=true)──▶ LLM         when a boundary is hit
 *
 * Escalation is not an error: it is a typed signal that this step belongs to
 * the LLM. The boundaries, in the words the verdict uses:
 *
 *   - writing     : the step must produce new content (text, code, free-form
 *     tool arguments). Structurally impossible for Jev; decided BEFORE
 *     calling it.
 *   - open_ended  : the question cannot be expressed as noul / choice / score
 *     (no enumerable options, no ordered levels). Decided BEFORE calling.
 *   - oversized   : the state itself does not fit in Jev's context. Also
 *     decided BEFORE calling, for the whole batch.
 *   - unsure      : Jev answered but the distribution is too flat to act on.
 *     Decided AFTER calling, against the threshold for that answer's
 *     confidence source (see `ConfidenceSource`).
 *
 * Plus one operational reason, `unreachable`: Jev being down must degrade to
 * "the LLM handles it", never block the loop.
 *
 * Questions are written with the three builders at the bottom of this file —
 * `check` (noul), `pick` (choice), `rate` (score). The type names and wire
 * values keep Jev's own vocabulary; the builders only spell it in English.
 */
/** Jev's three question primitives. */
export type QuestionType = "noul" | "choice" | "score";
/** Why control goes (back) to the LLM — the vocabulary of the whole handoff. */
export type EscalationReason = "writing" | "open_ended" | "oversized" | "unsure" | "unreachable";
/**
 * Where a verdict's `confidence` came from — the two are different quantities
 * and each has its own escalation threshold:
 *
 *   - reported  : the model reported it. Jev's own confidence head, returned
 *     for `choice` and `score` answers (never for `noul`).
 *   - estimated : jev-use worked it out from the answer's own distribution —
 *     top-minus-runner-up for `choice`/`score`, `2·|p − 0.5|` for `noul`.
 *     Systematically lower than the reported head on questions with more than
 *     two options, so it escalates below a lower number.
 */
export type ConfidenceSource = "reported" | "estimated";
/** noul only: what a yes and a no mean, to sharpen calibration. */
export interface NoulCriteria {
    true: string;
    false: string;
}
/**
 * A single typed question against a state — the shape that crosses the wire
 * and the shape screening validates. Written with `check` / `pick` / `rate`
 * rather than by hand.
 */
export interface Question {
    /** Caller-assigned id, echoed back in the verdict. Defaults to `q<index>`. */
    id?: string;
    type: QuestionType;
    /** The question text, e.g. "Did the test suite pass?" */
    question: string;
    /** choice only: >= 2 options — labels, or label → meaning. */
    options?: string[] | Record<string, string>;
    /** score only: >= 2 ordered level descriptions, worst-to-best or any fixed order. */
    levels?: string[];
    /** noul only (optional): what a yes and a no mean, to sharpen calibration. */
    criteria?: NoulCriteria;
}
/** "Is this true?" — the verdict answers with P(yes) in [0, 1]. Built by `check`. */
export interface NoulQuestion extends Question {
    type: "noul";
}
/**
 * "Which one?" — the verdict answers with one of the option labels. Built by
 * `pick`, which infers `Label` from the options you pass, so the answer is
 * typed as exactly those labels.
 */
export interface ChoiceQuestion<Label extends string = string> extends Question {
    type: "choice";
    options: Label[] | Record<Label, string>;
}
/**
 * "How much?" — the verdict answers with a possibly-fractional index into the
 * ordered levels (Jev returns the distribution's expectation, e.g. 1.99).
 * Built by `rate`.
 */
export interface ScoreQuestion extends Question {
    type: "score";
    levels: string[];
}
/**
 * The answer type a verdict for question `Q` carries: the option label for a
 * choice, a number for noul (probability) and score (level index).
 */
export type AnswerOf<Q> = Q extends ChoiceQuestion<infer Label> ? Label : Q extends NoulQuestion | ScoreQuestion ? number : number | string;
/** The state both parties share: any serializable context/environment. */
export type State = string | Record<string, unknown> | unknown[];
/** One batch for the engine: a state, its questions, and the call's limits. */
export interface JudgeRequest {
    state: State;
    questions: Question[];
    /**
     * Escalate any verdict whose confidence falls below this, whatever its
     * source. Unset, each verdict is judged against the threshold for its own
     * `confidenceFrom` (`REPORTED_` / `ESTIMATED_CONFIDENCE_THRESHOLD`).
     */
    confidenceThreshold?: number;
    /** Backend model id override, e.g. "jev-latest". */
    model?: string;
}
/** One verdict per question — the unit that crosses the handoff boundary. */
export interface Verdict<TAnswer extends number | string = number | string> {
    id: string;
    type: QuestionType;
    /**
     * noul   → P(yes) in [0, 1]
     * choice → the winning option label
     * score  → possibly-fractional index into `levels`
     * null when the question never reached Jev (handed back before the call).
     */
    answer: TAnswer | null;
    /** choice/score: full probability distribution, when the backend provides it. */
    distribution?: Record<string, number>;
    /** score: index → level description, echoing the request's levels. */
    legend?: Record<string, string>;
    /**
     * Confidence in [0, 1]. 0 when the question never reached Jev. Read it
     * together with `confidenceFrom`, which says how it was arrived at — the two
     * sources are different quantities with different escalation thresholds.
     */
    confidence: number;
    /**
     * How `confidence` was arrived at: `"reported"` = the model's own confidence
     * head, `"estimated"` = computed by jev-use from the answer's distribution.
     * Absent when the question never reached Jev, because nothing was measured.
     */
    confidenceFrom?: ConfidenceSource;
    /** True ⇒ the LLM should take this question over. */
    escalate: boolean;
    reason?: EscalationReason;
    /** Human-readable guidance for the LLM taking over. */
    hint?: string;
}
/** Token accounting a backend reported for one call, when it reports any. */
export interface Usage {
    inputTokens?: number;
    outputTokens?: number;
}
/**
 * The engine's result: one verdict per question, in the caller's order. This
 * is the shape the wire surfaces (MCP tools, `jev-use judge`) hand back; the
 * `Jev` client adds the answers keyed by name on top of it.
 */
export interface JudgeResult {
    verdicts: Verdict[];
    /** True if any verdict escalated — the one-glance signal for the caller. */
    escalated: boolean;
    /** Which backend actually served the call ("mock" | "typesafe" | ...). */
    backend: string;
    model?: string;
    latencyMs?: number;
    usage?: Usage;
}
/** The agent action a gate call judges. */
export interface GateAction {
    /** Tool / command name, e.g. "Bash". */
    tool: string;
    /** The tool input, verbatim. */
    input: string | Record<string, unknown>;
    /** What the action is meant to accomplish, when known. */
    description?: string;
}
/** An agent action to be gated (jev_gate sugar over a choice question). */
export interface GateRequest {
    state: State;
    action: GateAction;
    confidenceThreshold?: number;
    model?: string;
}
/** What a gate lets the agent do: run it, refuse it, or ask someone else. */
export type GateDecision = "allow" | "deny" | "escalate";
/** The verdict on one proposed action. */
export interface GateResult {
    decision: GateDecision;
    confidence: number;
    /** How that confidence was arrived at — see `ConfidenceSource`. */
    confidenceFrom?: ConfidenceSource;
    reason?: EscalationReason;
    distribution?: Record<string, number>;
    hint?: string;
    backend: string;
    latencyMs?: number;
    usage?: Usage;
}
/**
 * Escalate a model-reported confidence below this. Calibrated on 318 live
 * choice/score answers over four decision sets (bench/RESULTS.md, "Findings
 * that changed the defaults"): every clear-cut case stays decisive, the
 * 20-step triage loop escalates 0/60 steps, and the one command that used to
 * straddle the line — `sed -i` on tracked source — lands stably on `ask`.
 */
export declare const REPORTED_CONFIDENCE_THRESHOLD = 0.5;
/**
 * Escalate a jev-use-estimated confidence below this. Lower than the reported
 * threshold because the estimate is the same scale read conservatively: the
 * top-vs-runner-up margin runs a median 0.05 (up to 0.17) under the reported
 * head once the losing mass splits over three or more options.
 *
 * The two thresholds cannot be collapsed into one by recomputing the estimate:
 * the reported head equals the rescaled top probability for `choice` at any
 * option count, but NOT for `score` past two levels — measured, it can exceed
 * the winning level's own probability, so no function of the distribution
 * reproduces it (bench/RESULTS.md, "Not for `score` beyond two levels").
 */
export declare const ESTIMATED_CONFIDENCE_THRESHOLD = 0.4;
/** The threshold one confidence source escalates below, absent an override. */
export declare function confidenceThresholdFor(source: ConfidenceSource): number;
/**
 * Ceiling for the serialized state, in estimated tokens. Jev's context is
 * 64k with at most 32k for the state; stay under it with margin.
 */
export declare const DEFAULT_MAX_STATE_TOKENS = 30000;
/** The id a question gets when the caller named none. */
export declare function defaultQuestionId(index: number): string;
/** Normalize choice options to label → meaning ("" when labels-only). */
export declare function optionEntries(options: string[] | Record<string, string>): [string, string][];
/** Rough token estimate (~4 chars/token) — a guard rail, not an accountant. */
export declare function estimateTokens(state: State): number;
/** The state as the backends send it: strings verbatim, everything else JSON. */
export declare function serializeState(state: State): string;
/**
 * Ask whether something is true (Jev's `noul` primitive). The verdict answers
 * with the probability, and `confidence` is how far that sits from a coin flip.
 *
 * ```ts
 * check("Did the run fully succeed?")
 * check("Is the branch safe to merge?", {
 *   true: "green CI and no conflicts",
 *   false: "anything failing or unmerged",
 * })
 * ```
 */
export declare function check(question: string, criteria?: NoulCriteria): NoulQuestion;
/**
 * Ask which of the enumerated options fits (Jev's `choice` primitive). Pass
 * labels, or label → what picking it means (the meanings measurably help).
 * The verdict answers with one of those labels, and nothing else.
 *
 * ```ts
 * pick("Next action?", { merge: "all green", rerun: "looks flaky", hold: "needs attention" })
 * pick("Next action?", ["merge", "rerun", "hold"])
 * ```
 *
 * Fewer than two options is not a choice; such a question escalates as
 * `open_ended` instead of being sent.
 */
export declare function pick<const Label extends string>(question: string, options: Label[] | Record<Label, string>): ChoiceQuestion<Label>;
/**
 * Ask where the state sits on an ordered scale (Jev's `score` primitive). The
 * verdict answers with a possibly-fractional index into the levels, and
 * `legend` maps indices back to your words.
 *
 * ```ts
 * rate("How risky?", ["routine", "worth a look", "incident"])
 * ```
 *
 * Fewer than two levels is not a scale; such a question escalates as
 * `open_ended` instead of being sent.
 */
export declare function rate(question: string, levels: string[]): ScoreQuestion;
