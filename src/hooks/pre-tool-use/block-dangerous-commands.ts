import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentPayload, PermissionDecision, ShellViolation } from "@/types/index.js";
import { normalizeCommand, splitShellCommands, unwrapShellCommand } from "@/utils/shell.js";
import { runHook } from "@/utils/hook-wrapper.js";

const MODE = (process.env.AI_HOOK_MODE || "deny") as PermissionDecision;
const LOG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".ai-hooks", "logs");

const HARD_BLOCKS = [
  { id: "rm-root", reason: "rm targeting root filesystem", regex: /\brm\b(?:\s+[-\w]+)*\s+\/(?:\s|$|[;&|])/u },
  {
    id: "rm-home",
    reason: "rm targeting home directory",
    regex: /\brm\b(?:\s+[-\w]+)*\s+(~\/?|\$HOME)(?:\s|$|[;&|])/u,
  },
  {
    id: "rm-system",
    reason: "rm targeting critical system directory",
    regex: /\brm\b(?:\s+[-\w]+)*\s+\/(?:etc|usr|var|bin|sbin|lib|boot|dev|proc|sys)(?:\/|\s|$)/u,
  },
  {
    id: "dd-disk",
    reason: "dd writing to block device",
    regex: /\bdd\b.*\bof=\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|nvme\d+n\d+(?:p\d+)?)(?:\s|$)/u,
  },
  {
    id: "mkfs-device",
    reason: "filesystem format on block device",
    regex: /\bmkfs(?:\.\w+)?\b\s+\/dev\/(?:sd[a-z]\d*|hd[a-z]\d*|vd[a-z]\d*|xvd[a-z]\d*|nvme\d+n\d+(?:p\d+)?)(?:\s|$)/u,
  },
  { id: "fork-bomb", reason: "fork bomb detected", regex: /:\(\)\s*\{[^}]*:\s*\|\s*:\s*&\s*\}/u },
  {
    id: "curl-pipe-shell",
    reason: "piping remote content to shell",
    regex: /\b(?:curl|wget)\b.*\|\s*(?:bash|sh|zsh)\b/u,
  },
  {
    id: "shell-c-remote",
    reason: "shell executing remote script directly",
    regex: /\b(?:bash|sh|zsh)\b\s+-c\s+["'][^"']*(?:curl|wget)[^"']*\|\s*(?:bash|sh|zsh)\b/u,
  },
];

export const logToFile = (entry: Record<string, unknown>): void => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // Silently fail
  }
};

export const findViolation = (raw: string): ShellViolation | null => {
  const normalized = normalizeCommand(raw);
  const unwrapped = unwrapShellCommand(normalized);

  const candidates = [normalized, unwrapped, ...splitShellCommands(normalized), ...splitShellCommands(unwrapped)];

  for (const candidate of candidates) {
    for (const rule of HARD_BLOCKS) {
      if (rule.regex.test(candidate)) {
        return { inspected: candidate, rule };
      }
    }
  }
  return null;
};

export const extractToolData = (payload: AgentPayload): { command: string; toolName: string } => {
  const toolName = payload.toolName || "";
  const input = (payload.toolInput as Record<string, string>) || {};

  // Check all known command field names across agents.
  // AGY's run_command uses "CommandLine" (capital L); Claude uses "command"; Codex uses "cmd".
  const command =
    typeof input === "string"
      ? input
      : input.command || input.cmd || input.commandLine || input.CommandLine || input.raw_command || "";

  return { command, toolName };
};

export const isShellTool = (toolName: string): boolean => {
  return /^(Bash|run_command|shell|terminal|run_shell_command)$/i.test(toolName);
};

export const handler = (payload: AgentPayload) => {
  const { command, toolName } = extractToolData(payload);

  if (!isShellTool(toolName) || !command) {
    return;
  }

  const violation = findViolation(command);
  if (!violation) {
    return;
  }

  const reason = `[${violation.rule.id}] ${violation.rule.reason}`;
  const decision: PermissionDecision = MODE === "ask" ? "ask" : "deny";

  const logEntry = {
    command,
    inspected: violation.inspected,
    level: decision.toUpperCase(),
    reason,
    rule: violation.rule.id,
    toolName,
  };

  logToFile(logEntry);
  process.stderr.write(`[ai-hooks:block-dangerous-commands] blocked shell command: ${JSON.stringify(logEntry)}\n`);

  return { decision, reason };
};

if (import.meta.url.endsWith(path.basename(process.argv[1] || ""))) {
  runHook(handler);
}
