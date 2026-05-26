import type { AgentPayload, HookOutput, PermissionDecision } from "@/types/index.js";
import { getPayload } from "./payload.js";

export interface HookResult {
  decision?: PermissionDecision | undefined;
  reason?: string | undefined;
  eventName?: "PreToolUse" | "PostToolUse" | "BeforeToolSelection" | undefined;
  extraOutput?: Record<string, unknown> | undefined;
}

/**
 * Each agent expects a different JSON shape on stdout:
 * - Claude: { hookSpecificOutput: { hookEventName, permissionDecision, ... } }
 * - AGY:    { action: "allow"|"deny"|"ask", message: "..." }
 * - Codex:  { hookSpecificOutput: { ... } }  (same as Claude for now)
 * Exit code 2 is a universal fallback for deny across all agents.
 */
const AGENT = (process.env.AI_AGENT_TYPE || "claude").toLowerCase().trim();

const buildDenyOutput = (
  decision: PermissionDecision,
  reason: string | undefined,
  extra: Record<string, unknown> | undefined,
  eventName: string,
): string => {
  if (AGENT === "agy") {
    // AGY hook response format: { action, message }
    return JSON.stringify({ action: decision, message: reason ?? "Hook blocked this action" });
  }
  // Claude / Codex format
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: eventName as "PreToolUse" | "PostToolUse" | "BeforeToolSelection",
      permissionDecision: decision,
      permissionDecisionReason: reason,
      ...extra,
    },
  };
  return JSON.stringify(output);
};

const buildAllowOutput = (extra: Record<string, unknown> | undefined, eventName: string): string => {
  if (AGENT === "agy") {
    return JSON.stringify({ action: "allow" });
  }
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: eventName as "PreToolUse" | "PostToolUse" | "BeforeToolSelection",
      permissionDecision: "allow",
      ...extra,
    },
  };
  return JSON.stringify(output);
};

/**
 * Standardizes hook execution:
 * 1. Reads stdin safely.
 * 2. Parses and adapts payload via getPayload.
 * 3. Executes the business logic (handler).
 * 4. Outputs agent-specific JSON to stdout.
 * 5. Uses exit code 2 as a fallback blocking mechanism on 'deny'.
 * 6. Implements fail-safe no-op behavior on parse or runtime errors.
 */
export const runHook = async (
  handler: (payload: AgentPayload) => Promise<HookResult | void> | (HookResult | void),
): Promise<void> => {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    // Strip UTF-8 BOM (U+FEFF) that Windows tools can prepend, which breaks JSON.parse
    const sanitized = input.replace(/^\uFEFF/, "");
    const raw = JSON.parse(sanitized || "{}");
    const payload = getPayload(raw);

    const result = await handler(payload);
    const eventName = result?.eventName ?? "PreToolUse";

    if (result && result.decision && result.decision !== "allow") {
      process.stdout.write(buildDenyOutput(result.decision, result.reason, result.extraOutput, eventName));
      if (result.decision === "deny") {
        process.exitCode = 2; // Fallback for CLIs that block on non-zero exit
      }
      return;
    } else if (result && result.extraOutput) {
      // Allowed but returning injected context or filtered tools
      process.stdout.write(buildAllowOutput(result.extraOutput, eventName));
      return;
    }

    // Default allow / no-op
    if (AGENT === "agy") {
      process.stdout.write(JSON.stringify({ action: "allow" }));
    } else {
      process.stdout.write(JSON.stringify({}));
    }
  } catch (err) {
    // Fail-safe no-op behavior
    process.stderr.write(`[ai-hooks:wrapper] Error processing hook: ${(err as Error).message}\n`);
    process.stdout.write(JSON.stringify({}));
  }
};
