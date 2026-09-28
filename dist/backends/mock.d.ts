/**
 * Deterministic mock backend: lets the MCP server, tests, and demos run
 * with no API key. Answers are derived from a stable hash of state +
 * question, so runs are reproducible; scripted answers can be injected.
 *
 * It mirrors the real providers' confidence provenance rather than inventing
 * one: `choice`/`score` answers carry a confidence field (so their verdicts
 * read `confidenceFrom: "reported"`), `noul` answers carry none (so theirs
 * read `"estimated"`, computed from the probability).
 */
import type { BackendRequest, BackendResponse, JevBackend, RawAnswer } from "./types.js";
/** Answers to return verbatim, keyed by question id; the rest are synthesized. */
export interface MockScript {
    [id: string]: RawAnswer;
}
export declare class MockBackend implements JevBackend {
    private readonly script;
    readonly name = "mock";
    constructor(script?: MockScript);
    judge(request: BackendRequest): Promise<BackendResponse>;
}
