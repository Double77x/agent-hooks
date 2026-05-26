import type { AgentPayload } from "@/types/index.js";

/**
 * Adapter for Codex (OpenAI).
 * Codex often uses a flatter structure or different naming:
 * {
 *   "name": "run_command",
 *   "arguments": "{\"cmd\": \"...\"}"
 * }
 */
export function translateCodex(raw: unknown): AgentPayload {
  const data = raw as Record<string, unknown>;
  let toolInput = (data.arguments as Record<string, unknown> | string) || (data.args as Record<string, unknown>) || {};
  if (typeof toolInput === "string") {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
      /* not json */
    }
  }

  return {
    toolName: (data.name as string) || (data.toolName as string),
    toolInput: toolInput as Record<string, unknown>,
    ...data,
  };
}
