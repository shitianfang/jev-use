/**
 * One-line installer: `npx jev-use install [claude|codex|pi]` wires the
 * MCP server (or the pi extension) into whichever harness CLIs are
 * present, by driving each harness's own config command — nothing is
 * written by hand. With no target, every CLI found gets configured.
 */
import { spawnSync } from "node:child_process";
import { SERVER_VERSION } from "./server.js";
/** The exact commands run per harness; pinned to this build's version. */
export function installPlan(version = SERVER_VERSION) {
    const serve = ["npx", "-y", `jev-use@${version}`, "serve"];
    return [
        { harness: "claude", command: "claude", args: ["mcp", "add", "--scope", "user", "jev", "--", ...serve] },
        { harness: "codex", command: "codex", args: ["mcp", "add", "jev", "--", ...serve] },
        { harness: "pi", command: "pi", args: ["install", "git:github.com/shitianfang/jev-use"] },
    ];
}
const shell = process.platform === "win32";
function cliPresent(command) {
    const probe = spawnSync(command, ["--version"], { stdio: "ignore", shell });
    return !probe.error && probe.status !== null;
}
/**
 * Run the plan (all harnesses found, or just `target`). Returns the process
 * exit code: 0 when something was installed, 1 when a step failed or nothing
 * was found, 2 when the target name is not a harness.
 */
export function runInstall(target) {
    const plan = installPlan().filter((step) => target === undefined || step.harness === target);
    if (plan.length === 0) {
        process.stderr.write(`jev-use install: unknown target "${target}" (claude | codex | pi)\n`);
        return 2;
    }
    let installed = 0;
    let failed = 0;
    for (const step of plan) {
        if (!cliPresent(step.command)) {
            process.stderr.write(`${step.harness}: '${step.command}' CLI not found${target ? "" : ", skipped"}\n`);
            if (target)
                return 1;
            continue;
        }
        const run = spawnSync(step.command, step.args, { stdio: "inherit", shell });
        if (run.status === 0) {
            installed++;
            process.stderr.write(`${step.harness}: installed (${step.command} ${step.args.join(" ")})\n`);
        }
        else {
            failed++;
            process.stderr.write(`${step.harness}: '${step.command}' exited ${run.status}\n`);
        }
    }
    if (installed === 0 && failed === 0) {
        process.stderr.write("no harness CLI found (claude / codex / pi) — nothing installed\n");
        return 1;
    }
    if (installed > 0) {
        process.stderr.write("next: set TYPESAFE_API_KEY, OPENROUTER_API_KEY, or AI_GATEWAY_API_KEY " +
            "in the environment your harness runs in (JEV_BACKEND=mock for a keyless dry run)\n");
    }
    return failed > 0 ? 1 : 0;
}
