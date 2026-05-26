import type { AgentPayload } from "@/types/index.js";

/**
 * Adapter for AGY (Custom/Advanced Agent).
 * AGY often uses deep nesting or session context.
 */
export function translateAGY(raw: unknown): AgentPayload {
  const data = raw as Record<string, unknown>;
  return {
    toolName: (data.tool as string) || (data.name as string),
    toolInput: (data.input as Record<string, unknown>) || (data.args as Record<string, unknown>),
    ...data,
  };
}
