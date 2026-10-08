/**
 * Required evidence review is independent of model confidence.
 * Callers obtain these records from their own check and authorization sources;
 * model-generated records are not evidence. This example never executes actions.
 * Keyless demo: npm run build && node examples/evidence-review.mjs
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Jev, MockBackend } from "../dist/index.js";

export function fingerprintAction(action) {
  if (!action || typeof action.tool !== "string" || !action.tool.trim() ||
      !(typeof action.input === "string" || (action.input && typeof action.input === "object" && !Array.isArray(action.input)))) return null;
  try {
    return createHash("sha256").update(JSON.stringify({ tool: action.tool, input: action.input, description: action.description ?? null })).digest("hex");
  } catch { return null; }
}

export function reviewPrerequisites(evidence, action) {
  const review = (reason) => ({ decision: "escalate", source: "prerequisites", reason });
  const actionHash = fingerprintAction(action);
  if (!actionHash || !evidence || typeof evidence.commit !== "string" ||
      !/^[a-f0-9]{40}$/i.test(evidence.commit)) {
    return review("invalid_target");
  }
  const { commit, approval, checks } = evidence;
  const authorityMatches = approval?.commit === commit && approval?.actionHash === actionHash;
  if (authorityMatches && approval.allowed === false) {
    return { decision: "deny", source: "prerequisites", reason: "prohibited" };
  }
  if (!Array.isArray(checks) || checks.some((check) =>
    !check || typeof check.commit !== "string" || !["passed", "failed"].includes(check.result))) {
    return review("invalid_checks");
  }
  const current = checks.filter((check) => check.commit === commit);
  const passed = current.some((check) => check.result === "passed");
  const failed = current.some((check) => check.result === "failed");
  if (passed && failed) return review("conflicting_checks");
  if (failed) return { decision: "deny", source: "prerequisites", reason: "failed_check" };
  if (!passed) return review(checks.length ? "stale_checks" : "missing_checks");
  if (!authorityMatches || approval.allowed !== true) return review("missing_authority");
  return null; // Prerequisites established; the advisory gate may now be consulted.
}

export async function gateWithEvidence(jev, evidence, state, action) {
  const required = reviewPrerequisites(evidence, action);
  if (required) return required; // No provider request, whatever its confidence would be.
  return { ...(await jev.gate(state, action)), source: "advisory_gate" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const commit = "a".repeat(40);
  const action = { tool: "Bash", input: "git push origin topic" };
  const evidence = {
    commit,
    checks: [{ commit, result: "passed" }],
    approval: { commit, actionHash: fingerprintAction(action), allowed: true },
  };
  // Explicit mock selection guarantees the demo never uses a stored credential.
  const jev = new Jev({ backend: new MockBackend({ gate: { answer: "allow", confidence: 1 } }) });
  console.log("Scripted mock demo; action text is never executed.");
  for (const [name, record] of [
    ["complete", evidence],
    ["missing authority", { ...evidence, approval: undefined }],
    ["stale check", { ...evidence, checks: [{ commit: "b".repeat(40), result: "passed" }] }],
  ]) {
    console.log(name, await gateWithEvidence(jev, record, "Synthetic evidence only", action));
  }
}
