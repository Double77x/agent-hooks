import * as path from "node:path";
import type { AgentPayload, PermissionDecision } from "@/types/index.js";
import { runHook } from "@/utils/hook-wrapper.js";
import { readState, writeState } from "@/utils/state.js";

const PLAN_KEYWORDS = ["plan", "strategy", "approach", "implementation details"];

export const checkPlanRequirement = (payload: AgentPayload): { decision: PermissionDecision; reason?: string } => {
  const toolName = payload.toolName || "";
  const input = (payload.toolInput as Record<string, string>) || {};

  const isEditTool = /^(Write|Edit|replace|write_file|edit_file)$/i.test(toolName);
  const isThoughtTool = /^(thought|plan|strategy|update_topic)$/i.test(toolName);

  // Read persisted session state
  let planProvided = readState<boolean>("plan_provided", false);

  if (isThoughtTool) {
    const content = typeof input === "string" ? input : JSON.stringify(input);
    if (PLAN_KEYWORDS.some((k) => content.toLowerCase().includes(k))) {
      planProvided = true;
      writeState("plan_provided", true);
    }
  }

  if (isEditTool && !planProvided) {
    if (toolName.toLowerCase().includes("write")) {
      return {
        decision: "ask",
        reason:
          "📝 [workflow] You are about to perform a significant edit. Please provide a clear plan/strategy first.",
      };
    }
  }

  return { decision: "allow" };
};

export const handler = (payload: AgentPayload) => {
  const { decision, reason } = checkPlanRequirement(payload);

  if (decision !== "allow") {
    process.stderr.write(`[ai-hooks:require-plan] Requesting plan before proceeding with ${payload.toolName}\n`);
    return { decision, reason };
  }

  return;
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
