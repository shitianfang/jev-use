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
import { type GateRequest, type GateResult, type JudgeRequest, type JudgeResult } from "./protocol.js";
import { type JevBackend } from "./backends/types.js";
/** Answer one batch of questions about one state. */
export declare function judge(backend: JevBackend, request: JudgeRequest): Promise<JudgeResult>;
/**
 * Gate an agent action: sugar over a single allow/deny choice question.
 *
 * The action is the one part of the judged state nobody wrote by hand — the
 * hook hands over whatever the agent proposed — so its credentials are
 * redacted before it leaves the machine (`redact.ts`). The state around it is
 * sent as given.
 */
export declare function gate(backend: JevBackend, request: GateRequest): Promise<GateResult>;
