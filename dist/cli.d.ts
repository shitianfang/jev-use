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
/**
 * The state one gate call judges: what the hook event itself says, plus
 * whatever `JEV_GATE_STATE` adds. The hook event carries the cwd and the
 * permission mode and nothing else, so facts that change the answer —
 * "production credentials exist in the environment", "this checkout is a
 * customer's data" — can only come from the user. `extra` is appended to the
 * context, ahead of the judging instruction so that instruction stays next to
 * the action it refers to; unset (or blank) means no line is added at all.
 */
export declare function gateState(event: Record<string, unknown>, extra?: string): string;
/**
 * The confidence a verdict must reach or it escalates, and where those numbers
 * come from. Same precedence the engine applies (judge.ts → dispatch.ts): an
 * explicit threshold covers every verdict, otherwise each verdict is judged
 * against the threshold for its own confidence source — a model-reported head
 * and an estimate off the distribution are different quantities. Nothing here
 * decides anything: it is what `doctor` prints, so the numbers a user reads are
 * the numbers their calls will use.
 */
export declare function effectiveThresholds(override?: number): {
    reported: number;
    estimated: number;
    source: string;
};
export declare const HELP = "jev-use 0.8.0 \u2014 the typed handoff between your LLM and Jev\n\nusage:\n  jev-use install [claude|codex|pi]      wire the MCP server into your harness (all found, if no target)\n  jev-use serve [--backend name]         stdio MCP server\n  jev-use hook gate [--threshold N]      PreToolUse hook adapter (Claude Code / Codex)\n  jev-use judge ['{...}']                one-shot JudgeRequest from argv or stdin\n  jev-use doctor                         backend + one live round trip + permission rules\n\nbackends: typesafe (TYPESAFE_API_KEY) | openrouter (OPENROUTER_API_KEY)\n        | vercel (AI_GATEWAY_API_KEY) | mock. Auto-detected from env,\n        or forced with --backend / JEV_BACKEND. Model override: JEV_MODEL.\n\nhook gate also reads two env vars: JEV_GATE_THRESHOLD, the confidence to\nescalate below \u2014 unset, each answer's confidence source decides, and\njev-use doctor prints both numbers in effect \u2014 and JEV_GATE_STATE, facts the\nhook event cannot carry, appended to every judged state.\n";
