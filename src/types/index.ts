export interface AgentPayload {
  toolName: string;
  toolInput: Record<string, unknown> | string;
  availableTools?: string[];
  [key: string]: unknown;
}

export type PermissionDecision = "allow" | "ask" | "deny";

export interface HookSpecificOutput {
  hookEventName: "PreToolUse" | "PostToolUse" | "BeforeToolSelection";
  permissionDecision?: PermissionDecision | undefined;
  permissionDecisionReason?: string | undefined;
  filteredToolNames?: string[] | undefined;
  injectedContext?: string | undefined;
  [key: string]: unknown;
}

export interface HookOutput {
  hookSpecificOutput: HookSpecificOutput;
}

export interface ShellViolation {
  rule: { id: string; reason: string; regex: RegExp };
  inspected: string;
}
