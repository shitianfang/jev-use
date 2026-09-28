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
import type { JevBackend } from "./backends/types.js";
export declare const SERVER_NAME = "jev-use";
export declare const SERVER_VERSION = "0.8.0";
/** Build the MCP server: two tools over one already-resolved backend. */
export declare function createServer(backend: JevBackend): McpServer;
