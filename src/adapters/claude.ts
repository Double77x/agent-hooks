import type { AgentPayload } from "@/types/index.js";

/**
 * Adapter for Claude (Anthropic).
 * Claude payloads typically use:
 * {
 *   "tool_name": "Bash",
 *   "tool_input": { "command": "..." }
 * }
 */
export function translateClaude(raw: unknown): AgentPayload {
  const data = raw as Record<string, unknown>;
  return {
    toolName: (data.tool_name as string) || (data.toolName as string),
    toolInput: (data.tool_input as Record<string, unknown>) || (data.toolInput as Record<string, unknown>),
    // Carry over other fields
    ...data,
  };
}
