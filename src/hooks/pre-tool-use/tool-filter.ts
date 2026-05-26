import * as path from "node:path";
import type { AgentPayload, PermissionDecision } from "@/types/index.js";
import { runHook } from "@/utils/hook-wrapper.js";

/**
 * Filter tools based on an explicit allowlist in restricted mode.
 * This is a 'BeforeToolSelection' style hook.
 */
export const filterAvailableTools = (payload: AgentPayload): { filteredToolNames?: string[] } => {
  const isRestrictedMode = process.env.AI_RESTRICTED_MODE === "1";
  const availableTools = payload.availableTools || [];

  if (isRestrictedMode && availableTools.length > 0) {
    // Explicit allowlist of safe tools
    const ALLOWED_TOOLS = new Set([
      "read_file",
      "list_directory",
      "grep_search",
      "web_fetch",
      "ask_user",
      "thought",
      "plan",
    ]);

    const filtered = availableTools.filter((t) => ALLOWED_TOOLS.has(t));
    return { filteredToolNames: filtered };
  }

  return {};
};

export const handler = (payload: AgentPayload) => {
  const { filteredToolNames } = filterAvailableTools(payload);

  if (filteredToolNames) {
    process.stderr.write(
      `[ai-hooks:tool-filter] Restricted mode active. Filtered tools down to ${filteredToolNames.length} allowed tools.\n`,
    );
    return {
      decision: "allow" as PermissionDecision,
      eventName: "BeforeToolSelection" as const,
      extraOutput: { filteredToolNames },
    };
  }

  return;
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
