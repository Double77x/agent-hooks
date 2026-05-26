import * as path from "node:path";
import type { AgentPayload, PermissionDecision } from "@/types/index.js";
import { runHook } from "@/utils/hook-wrapper.js";

const ALLOWED_NODE_MANAGER = process.env.AI_ALLOWED_NODE_MANAGER || "pnpm";
const ALLOWED_PYTHON_MANAGER = process.env.AI_ALLOWED_PYTHON_MANAGER || "uv";

const FORBIDDEN_NODE = ["pnpm", "npm", "yarn", "bun"].filter((m) => m !== ALLOWED_NODE_MANAGER);
const FORBIDDEN_PYTHON = ["pip", "pip3", "poetry", "conda", "mamba", "pipenv"].filter(
  (m) => m !== ALLOWED_PYTHON_MANAGER,
);

export const checkCommand = (command: string): string | null => {
  const usedForbiddenNode = FORBIDDEN_NODE.find((m) => new RegExp(`\\b${m}\\b`).test(command));
  if (usedForbiddenNode) {
    return `🚫 [node-enforcement] This project uses ${ALLOWED_NODE_MANAGER}. Please do not use ${usedForbiddenNode}.`;
  }

  const usedForbiddenPython = FORBIDDEN_PYTHON.find((m) => new RegExp(`\\b${m}\\b`).test(command));
  if (usedForbiddenPython) {
    return `🐍 [python-enforcement] This project uses ${ALLOWED_PYTHON_MANAGER}. Please do not use ${usedForbiddenPython}.`;
  }

  return null;
};

export const handler = (payload: AgentPayload) => {
  const toolName = payload.toolName || "";
  const toolInput = (payload.toolInput as Record<string, string>) || {};

  let command = "";
  if (/^(Bash|run_command|shell|terminal|run_shell_command)$/i.test(toolName)) {
    command =
      toolInput.command || toolInput.cmd || toolInput.commandLine || (typeof toolInput === "string" ? toolInput : "");
  }

  if (!command) {
    return;
  }

  const violation = checkCommand(command);
  if (violation) {
    process.stderr.write(`[ai-hooks:pkg-manager-enforcement] blocked command: ${command}\n`);
    return { decision: "deny" as PermissionDecision, reason: violation };
  }

  return;
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
