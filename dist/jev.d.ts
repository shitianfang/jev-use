/**
 * The client. One `Jev` holds a resolved backend plus the defaults every call
 * inherits; questions are written with `check` / `pick` / `rate` and answers
 * come back keyed by the names you asked under.
 *
 * ```ts
 * const jev = new Jev();
 * const { answers } = await jev.judge(state, {
 *   next: pick("Next action?", { merge: "all green", rerun: "looks flaky", hold: "needs attention" }),
 *   passed: check("Did the run fully succeed?"),
 * });
 * answers.next.answer;  // "merge" | "rerun" | "hold" | null
 * ```
 *
 * This is a layer over the engine in `judge.ts` (screen → backend → hand back
 * what is unsure), not a second implementation of it. The wire surfaces — the
 * MCP tools, the pi tools, `jev-use judge` — call that engine directly, so
 * their JSON payload stays exactly the ordered `JudgeResult` an agent reads.
 */
import { type BackendName } from "./backends/index.js";
import type { JevBackend } from "./backends/types.js";
import { type AnswerOf, type GateAction, type GateResult, type JudgeResult, type Question, type State, type Verdict } from "./protocol.js";
/** How to build a client. Every field has a working default. */
export interface JevOptions {
    /**
     * Which backend to judge with: a provider name, `"mock"` for a keyless dry
     * run, or a ready-made backend (tests, custom transports). Default: resolved
     * from the environment — `JEV_BACKEND` if set, otherwise the first
     * credential found, and a named error if there is none.
     */
    backend?: BackendName | JevBackend;
    /** Environment consulted while resolving the backend. Default `process.env`. */
    env?: Record<string, string | undefined>;
    /**
     * Escalate verdicts below this confidence, whatever its source. Default: the
     * threshold for each verdict's own `confidenceFrom` — 0.5 for a confidence
     * the model reported, 0.4 for one estimated off the distribution.
     */
    confidenceThreshold?: number;
    /** Model id to send with every call, e.g. "jev-latest". Default: the backend's. */
    model?: string;
}
/** Per-call overrides of the client's defaults. */
export interface CallOptions {
    /** Escalate verdicts below this confidence, for this call only. */
    confidenceThreshold?: number;
    /** Model id for this call only. */
    model?: string;
}
/** Questions about one state, keyed by the name each answer comes back under. */
export type QuestionMap = Record<string, Question>;
/**
 * What one `judge` call produced: the engine's ordered verdicts, plus the same
 * verdicts keyed by name — `answers.next` for the question you asked as `next`.
 */
export interface Judgment<Q extends QuestionMap = QuestionMap> extends JudgeResult {
    /**
     * Verdicts keyed by your question names. Each answer is typed by its
     * question: an option label for `pick`, a number for `check` and `rate`,
     * and `null` when the question never reached Jev.
     */
    answers: {
        [K in keyof Q]: Verdict<AnswerOf<Q[K]>>;
    };
}
export declare class Jev {
    /** The backend serving this client; its `name` is what every result reports. */
    readonly backend: JevBackend;
    /** How that backend was chosen, e.g. "auto: TYPESAFE_API_KEY found". */
    readonly via: string;
    private readonly confidenceThreshold?;
    private readonly model?;
    constructor(options?: JevOptions);
    /**
     * Ask Jev everything you want to know about one state, in one call. Batching
     * is where the speedup lives: latency is nearly flat in question count.
     *
     * Never throws for reachable-world reasons — a question Jev cannot take and
     * an unreachable backend both come back as verdicts with `escalate: true`
     * and a typed `reason`.
     */
    judge<Q extends QuestionMap>(state: State, questions: Q, options?: CallOptions): Promise<Judgment<Q>>;
    /** Array form: answers are keyed by each question's id (`q0`, `q1`, ... by default). */
    judge(state: State, questions: Question[], options?: CallOptions): Promise<Judgment>;
    /**
     * Risk-check one proposed action against the current state — one allow/deny
     * choice under the hood.
     *
     * ```ts
     * const verdict = await jev.gate(state, { tool: "Bash", input: { command } });
     * verdict.decision;  // "allow" | "deny" | "escalate"
     * ```
     *
     * `escalate` means Jev is not sure enough either way, so a human or the LLM
     * decides; an unreachable backend escalates too, never denies.
     */
    gate(state: State, action: GateAction, options?: CallOptions): Promise<GateResult>;
}
