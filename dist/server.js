/**
 * The MCP surface. Only `tools` are used — the one MCP primitive every
 * major harness (Claude Code, Codex CLI, Cursor, Gemini CLI, VS Code,
 * pi) supports — so jev-use works anywhere MCP does. The handoff-return
 * leg is expressed entirely in tool RESULTS (`escalate` + `reason`),
 * never as a server-initiated callback.
 *
 * The tools call the engine directly rather than the `Jev` client: the
 * client's extra `answers` map would duplicate every verdict in a payload an
 * LLM pays for, and a tool result is exactly the ordered `JudgeResult`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gate, judge } from "./judge.js";
import { ESTIMATED_CONFIDENCE_THRESHOLD, REPORTED_CONFIDENCE_THRESHOLD, } from "./protocol.js";
export const SERVER_NAME = "jev-use";
export const SERVER_VERSION = "0.8.0";
/** The `Question` shape as MCP callers send it — the wire contract, unchanged. */
const questionShape = z.object({
    id: z
        .string()
        .optional()
        .describe("Your identifier for this question; echoed back in the verdict."),
    type: z
        .enum(["noul", "choice", "score"])
        .describe("noul = probability that something is true; choice = pick one of enumerated options; " +
        "score = place the state on an ordered list of levels."),
    question: z.string().describe("The question, phrased about the state."),
    options: z
        .union([z.array(z.string()), z.record(z.string(), z.string())])
        .optional()
        .describe("choice only: >= 2 distinct options — a list of labels, or a map of label -> what picking it means."),
    levels: z
        .array(z.string())
        .optional()
        .describe("score only: >= 2 ORDERED level descriptions (e.g. ['broken', 'works but rough', 'production ready']). " +
        "The answer is a possibly-fractional index into this list."),
    criteria: z
        .object({ true: z.string(), false: z.string() })
        .optional()
        .describe("noul only (optional): what a yes and a no mean, to sharpen calibration."),
});
/** Build the MCP server: two tools over one already-resolved backend. */
export function createServer(backend) {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    server.registerTool("jev_judge", {
        title: "Batch fast judgments with Jev",
        description: "Hand a batch of quick judgment questions to Jev (TypeSafe AI's System One model): " +
            "a typed verdict in a few hundred milliseconds, at a judgment-model rate instead of " +
            "LLM reasoning. " +
            "Use it whenever the next step is a JUDGMENT over facts you ALREADY have in context — did X " +
            "succeed, which option next, how good is Y — not a generation. Batch every question you " +
            "have about one state into ONE call (batching is where the speedup comes from). " +
            "If the items to judge are sitting in a file or in tool output, pipe that file to the " +
            "`jev-use judge` CLI from the shell instead, so the data never passes through this " +
            "conversation. " +
            "Do NOT use it for anything that needs new text/code written, or choices whose options you " +
            "cannot enumerate — that work is yours. " +
            "Each verdict returns {answer, confidence, confidenceFrom, escalate, reason, hint}. " +
            "confidenceFrom says where the number came from: \"reported\" = Jev's own confidence head, " +
            "\"estimated\" = worked out by jev-use from the answer's distribution. escalate=true means the " +
            "question is handed back to you: writing/open_ended = structurally yours, " +
            "oversized = the state is too big to judge, " +
            "unsure = Jev's answer is only a prior (it is still included) — decide yourself, " +
            "unreachable = Jev is down, proceed without it.",
        inputSchema: {
            state: z
                .string()
                .describe("The shared context/environment both parties judge against: relevant facts, recent tool " +
                "output, file excerpts — facts you ALREADY have. Serialize objects to JSON. Keep it " +
                "under ~30k tokens, and never read a file into your context just to paste it here: " +
                "pipe the file to `jev-use judge` from the shell instead."),
            questions: z
                .array(questionShape)
                .min(1)
                .describe("All questions you have about this state — batch them."),
            confidence_threshold: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe(
            // Built from the constants the engine applies, never retyped: this
            // string said "Default 0.75" while calls escalated below 0.4.
            `Escalate verdicts below this confidence. Unset: ${REPORTED_CONFIDENCE_THRESHOLD} for a ` +
                `confidence Jev reported, ${ESTIMATED_CONFIDENCE_THRESHOLD} for one jev-use estimated ` +
                "from the answer's distribution (each verdict says which, in confidenceFrom)."),
            model: z.string().optional().describe("Backend model override, e.g. jev-latest."),
        },
    }, async ({ state, questions, confidence_threshold, model }) => {
        const result = await judge(backend, {
            state,
            questions,
            confidenceThreshold: confidence_threshold,
            model,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    server.registerTool("jev_gate", {
        title: "Gate an action with Jev",
        description: "Ask Jev to risk-check ONE proposed agent action against the current state in a single " +
            "sub-second call. Returns {decision: allow|deny|escalate, confidence, confidenceFrom, hint}. " +
            "escalate means Jev is not sure enough either way — judge the action yourself. " +
            "Use this by hand only for a one-off risky/irreversible action. If gating is per-tool-call " +
            "and repeats, do not call this every turn: wire `jev-use hook gate` as a PreToolUse hook " +
            "once and the decision leaves the conversation entirely — measured, 24 gated commands cost " +
            "17.1s and ZERO LLM tokens through the hook, vs 46.9s and $0.2366 through a supervisor LLM.",
        inputSchema: {
            state: z
                .string()
                .describe("Current task context the action should be judged against."),
            tool: z.string().describe("Name of the tool/command about to run."),
            input: z.string().describe("The action's input/arguments, verbatim."),
            description: z
                .string()
                .optional()
                .describe("What the action is meant to accomplish."),
            confidence_threshold: z.number().min(0).max(1).optional(),
            model: z.string().optional(),
        },
    }, async ({ state, tool, input, description, confidence_threshold, model }) => {
        const result = await gate(backend, {
            state,
            action: { tool, input, description },
            confidenceThreshold: confidence_threshold,
            model,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
        };
    });
    return server;
}
