/**
 * One-line installer: `npx jev-use install [claude|codex|pi]` wires the
 * MCP server (or the pi extension) into whichever harness CLIs are
 * present, by driving each harness's own config command — nothing is
 * written by hand. With no target, every CLI found gets configured.
 */
/** The harnesses jev-use knows how to wire itself into. */
export type Harness = "claude" | "codex" | "pi";
/** One harness's own config command, exactly as it will be run. */
export interface InstallStep {
    harness: Harness;
    command: string;
    args: string[];
}
/** The exact commands run per harness; pinned to this build's version. */
export declare function installPlan(version?: string): InstallStep[];
/**
 * Run the plan (all harnesses found, or just `target`). Returns the process
 * exit code: 0 when something was installed, 1 when a step failed or nothing
 * was found, 2 when the target name is not a harness.
 */
export declare function runInstall(target?: string): number;
