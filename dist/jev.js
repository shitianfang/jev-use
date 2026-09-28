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
import { createBackend } from "./backends/index.js";
import { gate as runGate, judge as runJudge } from "./judge.js";
import { defaultQuestionId, } from "./protocol.js";
export class Jev {
    /** The backend serving this client; its `name` is what every result reports. */
    backend;
    /** How that backend was chosen, e.g. "auto: TYPESAFE_API_KEY found". */
    via;
    confidenceThreshold;
    model;
    constructor(options = {}) {
        if (options.backend !== undefined && typeof options.backend !== "string") {
            this.backend = options.backend;
            this.via = `given: ${options.backend.name}`;
        }
        else {
            const resolved = createBackend(options.backend, options.env);
            this.backend = resolved.backend;
            this.via = resolved.via;
        }
        this.confidenceThreshold = options.confidenceThreshold;
        this.model = options.model;
    }
    async judge(state, questions, options = {}) {
        const asked = keyedQuestions(questions);
        const result = await runJudge(this.backend, {
            state,
            questions: asked.map(([key, question]) => ({ ...question, id: question.id ?? key })),
            confidenceThreshold: options.confidenceThreshold ?? this.confidenceThreshold,
            model: options.model ?? this.model,
        });
        const answers = {};
        asked.forEach(([key], index) => {
            answers[key] = result.verdicts[index];
        });
        return { ...result, answers };
    }
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
    async gate(state, action, options = {}) {
        return runGate(this.backend, {
            state,
            action,
            confidenceThreshold: options.confidenceThreshold ?? this.confidenceThreshold,
            model: options.model ?? this.model,
        });
    }
}
/**
 * One [name, question] pair per question, in the caller's order: the map's own
 * keys, or — for the array form — each question's id, defaulted the same way
 * the engine defaults it.
 */
function keyedQuestions(questions) {
    return Array.isArray(questions)
        ? questions.map((question, index) => [
            question.id ?? defaultQuestionId(index),
            question,
        ])
        : Object.entries(questions);
}
