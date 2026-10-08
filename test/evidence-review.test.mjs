import { describe, expect, it, vi } from "vitest";
import { Jev, MockBackend } from "../dist/index.js";
import { fingerprintAction, gateWithEvidence, reviewPrerequisites } from "../examples/evidence-review.mjs";

const commit = "a".repeat(40);
const evidence = () => ({
  commit,
  checks: [{ commit, result: "passed" }],
  approval: { commit, actionHash: fingerprintAction(action), allowed: true },
});
const action = { tool: "Bash", input: "git push origin topic" };

describe("required evidence before advisory gate", () => {
  it.each([
    ["missing checks", () => ({ ...evidence(), checks: [] }), "missing_checks"],
    ["stale checks", () => ({ ...evidence(), checks: [{ commit: "b".repeat(40), result: "passed" }] }), "stale_checks"],
    ["nonboolean approval", () => ({ ...evidence(), approval: { ...evidence().approval, allowed: "true" } }), "missing_authority"],
    ["missing approval", () => ({ ...evidence(), approval: undefined }), "missing_authority"],
    ["approval for another action", () => ({ ...evidence(), approval: { ...evidence().approval, actionHash: fingerprintAction({ ...action, input: "git push origin other-topic" }) } }), "missing_authority"],
    ["approval for another commit", () => ({ ...evidence(), approval: { ...evidence().approval, commit: "b".repeat(40) } }), "missing_authority"],
    ["conflicting checks", () => ({ ...evidence(), checks: [{ commit, result: "passed" }, { commit, result: "failed" }] }), "conflicting_checks"],
    ["malformed checks", () => ({ ...evidence(), checks: [null] }), "invalid_checks"],
    ["malformed target", () => ({ ...evidence(), commit: "" }), "invalid_target"],
  ])("routes %s to review without asking a confident model", async (_name, make, reason) => {
    const jev = { gate: vi.fn().mockResolvedValue({ decision: "allow", confidence: 1 }) };
    expect(await gateWithEvidence(jev, make(), {}, action)).toEqual({ decision: "escalate", source: "prerequisites", reason });
    expect(jev.gate).not.toHaveBeenCalled();
  });

  it("keeps explicit prohibition and failed checks as denial", () => {
    expect(reviewPrerequisites({ ...evidence(), approval: { ...evidence().approval, allowed: false } }, action)).toMatchObject({ decision: "deny", reason: "prohibited" });
    expect(reviewPrerequisites({ ...evidence(), checks: [{ commit, result: "failed" }] }, action)).toMatchObject({ decision: "deny", reason: "failed_check" });
  });

  it.each([
    ["allow", 1, "allow"], ["deny", 1, "deny"], ["allow", 0.1, "escalate"],
  ])("preserves native gate result %s at confidence %s", async (answer, confidence, decision) => {
    const backend = new MockBackend({ gate: { answer, confidence } });
    const spy = vi.spyOn(backend, "judge");
    const result = await gateWithEvidence(new Jev({ backend }), evidence(), {}, action);
    expect(result).toMatchObject({ decision, confidence, source: "advisory_gate" });
    expect(spy).toHaveBeenCalledOnce();
  });
});
