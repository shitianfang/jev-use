/**
 * Stand-in for a backend that could not be resolved. A long-lived server
 * must not die because no key is set yet: it starts, the harness shows it
 * connected, and the missing credential is reported on the first call —
 * where the agent can read the remedy — instead of as a connection failure.
 */
import type { BackendResponse, JevBackend } from "./types.js";
export declare class UnconfiguredBackend implements JevBackend {
    private readonly reason;
    readonly name = "unconfigured";
    constructor(reason: string);
    judge(): Promise<BackendResponse>;
}
