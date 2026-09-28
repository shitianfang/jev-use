/**
 * jev-use public API.
 *
 * ```ts
 * import { Jev, check, pick, rate } from "jev-use";
 *
 * const jev = new Jev();
 * const { answers } = await jev.judge(state, { passed: check("Did the run fully succeed?") });
 * ```
 *
 * Both halves of the handoff are here: `route` decides before any call that a
 * step is the LLM's (`writing` / `open_ended`), and every verdict carries
 * `escalate` + `reason` + `hint` for the boundaries only Jev can see.
 *
 * The engine (`judge`/`gate`/the screening functions), the backend resolver
 * and the MCP server live one import deeper — `jev-use/dist/judge.js` and
 * friends — because they are the harness-facing internals, not the surface a
 * caller writes against.
 */
export { Jev } from "./jev.js";
export type { CallOptions, JevOptions, Judgment, QuestionMap } from "./jev.js";
export { check, pick, rate } from "./protocol.js";
export { redactSecrets, REDACTED } from "./redact.js";
export { route } from "./dispatch.js";
export type { Step, StepRoute } from "./dispatch.js";
export type { AnswerOf, ChoiceQuestion, ConfidenceSource, EscalationReason, GateAction, GateDecision, GateResult, JudgeResult, NoulCriteria, NoulQuestion, Question, QuestionType, ScoreQuestion, State, Usage, Verdict, } from "./protocol.js";
export { BackendError } from "./backends/types.js";
export type { BackendRequest, BackendResponse, JevBackend, RawAnswer, } from "./backends/types.js";
export type { BackendName } from "./backends/index.js";
export { MockBackend } from "./backends/mock.js";
export type { MockScript } from "./backends/mock.js";
export { TypeSafeBackend } from "./backends/typesafe.js";
export type { TypeSafeOptions } from "./backends/typesafe.js";
export { OpenRouterBackend } from "./backends/openrouter.js";
export type { OpenRouterOptions } from "./backends/openrouter.js";
export { VercelBackend } from "./backends/vercel.js";
export type { VercelOptions } from "./backends/vercel.js";
