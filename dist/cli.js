#!/usr/bin/env node
/**
 * jev-use CLI.
 *
 *   jev-use serve             stdio MCP server (Claude Code, Codex, Cursor, ...)
 *   jev-use hook gate         PreToolUse hook adapter (Claude Code & Codex hooks)
 *   jev-use judge [json]      one-shot judgment from argv or stdin (smoke/CI)
 *   jev-use doctor            resolve the backend, run one live round trip,
 *                             and check the harness's permission rules
 *
 * Flags: --backend typesafe|openrouter|vercel|mock, --threshold 0..1
 * Env:   JEV_GATE_THRESHOLD, JEV_GATE_STATE (both read by `hook gate`)
 *
 * Nothing here hard-codes an escalation threshold: unset, each verdict is
 * judged against the threshold for its own confidence source, and `doctor`
 * prints both numbers in effect.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBackend, createServerBackend } from "./backends/index.js";
import { Jev } from "./jev.js";
import { judge } from "./judge.js";
import { runInstall } from "./install.js";
import { check, ESTIMATED_CONFIDENCE_THRESHOLD, REPORTED_CONFIDENCE_THRESHOLD, } from "./protocol.js";
import { createServer, SERVER_VERSION } from "./server.js";
function parseArgs(argv) {
    const args = { command: [] };
    for (let i = 0; i < argv.length; i++) {
        const argument = argv[i];
        if (argument === "--backend")
            args.backend = argv[++i];
        else if (argument === "--threshold")
            args.threshold = Number(argv[++i]);
        else if (argument === "--help" || argument === "-h")
            args.command = ["help"];
        else if (argument === "--version" || argument === "-v")
            args.command = ["version"];
        else if (argument.startsWith("{"))
            args.json = argument;
        else
            args.command.push(argument);
    }
    return args;
}
/**
 * One backend resolution for every command. The CLI resolves it itself —
 * rather than letting `new Jev()` do it — because `--backend` accepts any
 * string and `via` is part of what `serve` and `doctor` print.
 */
function connect(args) {
    const { backend, via } = createBackend(args.backend);
    return { jev: new Jev({ backend }), backend, via };
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
}
async function serve(args) {
    const { backend, via } = createServerBackend(args.backend);
    process.stderr.write(`jev-use ${SERVER_VERSION} — backend ${backend.name} (${via})\n`);
    const server = createServer(backend);
    await server.connect(new StdioServerTransport());
}
/**
 * The state one gate call judges: what the hook event itself says, plus
 * whatever `JEV_GATE_STATE` adds. The hook event carries the cwd and the
 * permission mode and nothing else, so facts that change the answer —
 * "production credentials exist in the environment", "this checkout is a
 * customer's data" — can only come from the user. `extra` is appended to the
 * context, ahead of the judging instruction so that instruction stays next to
 * the action it refers to; unset (or blank) means no line is added at all.
 */
export function gateState(event, extra) {
    const lines = [
        `An autonomous coding agent is working in: ${String(event.cwd ?? "unknown")}`,
        `Permission mode: ${String(event.permission_mode ?? "default")}`,
    ];
    if (extra?.trim())
        lines.push(extra.trim());
    lines.push("The agent proposes the tool call below. Judge only whether it is safe to run without human review.");
    return lines.join("\n");
}
/**
 * The confidence a verdict must reach or it escalates, and where those numbers
 * come from. Same precedence the engine applies (judge.ts → dispatch.ts): an
 * explicit threshold covers every verdict, otherwise each verdict is judged
 * against the threshold for its own confidence source — a model-reported head
 * and an estimate off the distribution are different quantities. Nothing here
 * decides anything: it is what `doctor` prints, so the numbers a user reads are
 * the numbers their calls will use.
 */
export function effectiveThresholds(override) {
    if (override !== undefined) {
        return {
            reported: override,
            estimated: override,
            source: "--threshold / JEV_GATE_THRESHOLD",
        };
    }
    return {
        reported: REPORTED_CONFIDENCE_THRESHOLD,
        estimated: ESTIMATED_CONFIDENCE_THRESHOLD,
        source: "jev-use defaults, by confidence source",
    };
}
/** One line for `doctor`: the thresholds in effect, however they were set. */
function thresholdLine(override) {
    const { reported, estimated, source } = effectiveThresholds(override);
    const numbers = reported === estimated
        ? `${reported}`
        : `${reported} reported / ${estimated} estimated`;
    return `escalate: below confidence ${numbers} (${source})\n`;
}
/**
 * PreToolUse hook adapter, shared by Claude Code and Codex (their hook
 * protocols are shape-compatible). Reads the hook event on stdin, asks
 * jev_gate, and emits a permission decision:
 *
 *   deny      → permissionDecision "deny"
 *   escalate  → permissionDecision "ask"   (a human or the LLM decides)
 *   allow     → NO output: fall through to the user's normal permission
 *               flow. The gate only ever tightens, never loosens.
 *
 * A failure BEFORE the call is fail-open (exit 0, no output): no credentials,
 * or stdin that was not a hook event. A failure of the provider itself is not
 * — the engine turns an unreachable backend into an escalate verdict, so a
 * 503, a refused connection or a timeout surfaces as `ask` with the reason
 * `unreachable`. A command nobody could judge is never waved through.
 */
async function hookGate(args) {
    let event;
    try {
        event = JSON.parse(await readStdin());
    }
    catch {
        process.stderr.write("jev-use hook: stdin was not hook-event JSON\n");
        return;
    }
    try {
        const { jev } = connect(args);
        const toolInput = event.tool_input ?? {};
        const result = await jev.gate(gateState(event, process.env.JEV_GATE_STATE), {
            tool: String(event.tool_name ?? "unknown"),
            input: typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput),
        }, { confidenceThreshold: args.threshold ?? envNumber("JEV_GATE_THRESHOLD") });
        if (result.decision === "allow")
            return; // stay silent: default flow decides
        const decision = result.decision === "deny" ? "deny" : "ask";
        const reason = result.decision === "deny"
            ? `Jev gate: denied (confidence ${result.confidence.toFixed(2)}).`
            : `Jev gate: not sure this is safe (${result.reason ?? "unsure"}) — please review.`;
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: decision,
                permissionDecisionReason: reason,
            },
        }) + "\n");
    }
    catch (error) {
        process.stderr.write(`jev-use hook: fail-open (${String(error)})\n`);
    }
}
/**
 * One-shot judgment for smoke tests and CI. Prints the engine's result
 * verbatim — the same JSON the MCP tool returns — so it stays diffable.
 */
async function judgeOnce(args) {
    const raw = args.json ?? (await readStdin());
    const request = JSON.parse(raw);
    const { backend } = connect(args);
    const result = await judge(backend, {
        ...request,
        confidenceThreshold: request.confidenceThreshold ?? args.threshold,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.escalated ? 3 : 0;
}
/** The allow rules a harness needs before it may call jev's MCP tools. */
const MCP_ALLOW_RULES = ["mcp__jev__jev_judge", "mcp__jev__jev_gate"];
/** The settings files a user would put those rules in: their own, then this project's. */
function claudeSettingsFiles() {
    return [
        join(homedir(), ".claude", "settings.json"),
        join(process.cwd(), ".claude", "settings.json"),
        join(process.cwd(), ".claude", "settings.local.json"),
    ];
}
/** The `permissions.allow` rules one settings file carries; none if it is absent or unreadable. */
function allowRules(file) {
    try {
        const settings = JSON.parse(readFileSync(file, "utf8"));
        const allow = settings.permissions?.allow;
        return Array.isArray(allow) ? allow.filter((rule) => typeof rule === "string") : [];
    }
    catch {
        return [];
    }
}
/**
 * Report whether Claude Code may call jev's MCP tools at all. No permission
 * mode auto-allows an MCP tool — `acceptEdits` covers file edits only — so the
 * call goes to "ask", and headless `claude -p` has nobody to ask: it is
 * refused. The remedy is an allow rule per tool (or `mcp__jev` for the whole
 * server), and pre-authorizing a tool that sends state to a third party is the
 * user's decision: doctor prints the snippet and never writes it.
 */
function reportClaudePermissions() {
    const probe = spawnSync("claude", ["--version"], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    if (probe.error || probe.status !== 0)
        return; // no claude CLI here: nothing to check
    const version = (probe.stdout ?? "").trim().split("\n")[0] || "found";
    const carriedBy = new Map(); // allowed tool -> the file allowing it
    for (const file of claudeSettingsFiles()) {
        for (const rule of allowRules(file)) {
            for (const tool of rule === "mcp__jev" ? MCP_ALLOW_RULES : [rule]) {
                if (MCP_ALLOW_RULES.includes(tool) && !carriedBy.has(tool))
                    carriedBy.set(tool, file);
            }
        }
    }
    const missing = MCP_ALLOW_RULES.filter((tool) => !carriedBy.has(tool));
    if (missing.length === 0) {
        const files = [...new Set(carriedBy.values())].join(", ");
        process.stdout.write(`claude  : ${version} — jev's MCP tools are allowed (${files})\n`);
        return;
    }
    process.stdout.write(`claude  : ${version} — no allow rule yet for ${missing.join(", ")}\n` +
        "          MCP tools are never auto-allowed (acceptEdits covers file edits only),\n" +
        "          and headless `claude -p` has nobody to ask, so the call is refused.\n" +
        `          Add to ${join(homedir(), ".claude", "settings.json")} (or a project's .claude/settings.json):\n\n` +
        '          {"permissions": {"allow": ["mcp__jev__jev_judge", "mcp__jev__jev_gate"]}}\n\n' +
        `          checked: ${claudeSettingsFiles().join(", ")}\n`);
}
async function doctor(args) {
    const { jev, via } = connect(args);
    process.stdout.write(`backend : ${jev.backend.name}\nvia     : ${via}\n` +
        thresholdLine(args.threshold ?? envNumber("JEV_GATE_THRESHOLD")));
    const started = Date.now();
    const { answers, model } = await jev.judge("doctor check: the string 'jev-use' appears in this state.", { ping: check("Does the state mention jev-use?") });
    const ping = answers.ping;
    process.stdout.write(`round   : ${Date.now() - started}ms (model ${model ?? "?"})\n` +
        `verdict : p=${String(ping.answer)} confidence=${ping.confidence.toFixed(2)}` +
        ` (${ping.confidenceFrom ?? "none"}) escalate=${ping.escalate}\n`);
    if (ping.reason === "unreachable") {
        process.stdout.write(`error   : ${ping.hint ?? "unknown"}\n`);
        process.exitCode = 1;
    }
    reportClaudePermissions();
}
export const HELP = `jev-use ${SERVER_VERSION} — the typed handoff between your LLM and Jev

usage:
  jev-use install [claude|codex|pi]      wire the MCP server into your harness (all found, if no target)
  jev-use serve [--backend name]         stdio MCP server
  jev-use hook gate [--threshold N]      PreToolUse hook adapter (Claude Code / Codex)
  jev-use judge ['{...}']                one-shot JudgeRequest from argv or stdin
  jev-use doctor                         backend + one live round trip + permission rules

backends: typesafe (TYPESAFE_API_KEY) | openrouter (OPENROUTER_API_KEY)
        | vercel (AI_GATEWAY_API_KEY) | mock. Auto-detected from env,
        or forced with --backend / JEV_BACKEND. Model override: JEV_MODEL.

hook gate also reads two env vars: JEV_GATE_THRESHOLD, the confidence to
escalate below — unset, each answer's confidence source decides, and
jev-use doctor prints both numbers in effect — and JEV_GATE_STATE, facts the
hook event cannot carry, appended to every judged state.
`;
function envNumber(name) {
    const value = process.env[name];
    if (value === undefined)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const [command, subcommand] = args.command;
    try {
        if (command === "install")
            process.exitCode = runInstall(subcommand);
        else if (command === "serve")
            await serve(args);
        else if (command === "hook" && subcommand === "gate")
            await hookGate(args);
        else if (command === "judge")
            await judgeOnce(args);
        else if (command === "doctor")
            await doctor(args);
        else if (command === "version")
            process.stdout.write(`${SERVER_VERSION}\n`);
        else
            process.stdout.write(HELP);
    }
    catch (error) {
        process.stderr.write(`jev-use: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
/**
 * Run a command only when node was pointed at this file, so tests (and
 * anything importing the CLI's helpers) don't execute one. npx runs us through
 * a symlinked bin, hence the realpath compare; the bin names cover runners that
 * copy the shim instead of linking it.
 */
function isEntryPoint() {
    const entry = process.argv[1];
    if (entry === undefined)
        return false;
    const self = fileURLToPath(import.meta.url);
    if (entry === self || ["jev-use", "cli.js", "cli.ts"].includes(basename(entry)))
        return true;
    try {
        return realpathSync(entry) === realpathSync(self);
    }
    catch {
        return false;
    }
}
if (isEntryPoint())
    void main();
